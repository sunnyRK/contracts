import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import deployer from '../../helpers/deployer.js'
import logDecoder from '../../helpers/log-decoder.js'
import ethUtils from 'ethereumjs-util'

import {
  getTxProof,
  verifyTxProof,
  getReceiptProof,
  verifyReceiptProof
} from '../../helpers/proofs'

import { getBlockHeader } from '../../helpers/blocks'
import MerkleTree from '../../helpers/merkle-tree'

import { build, buildInFlight } from '../../mockResponses/utils'

const crypto = require('crypto')
const utils = require('../../helpers/utils')
const web3Child = utils.web3Child

chai.use(chaiAsPromised).should()
let contracts, childContracts
let start = 0, predicate

contract('ERC721Predicate', async function(accounts) {
  const tokenId = '0x117'
  const user = accounts[0]
  const other = accounts[1]

  before(async function() {
    contracts = await deployer.freshDeploy()
    childContracts = await deployer.initializeChildChain(accounts[0])
  })

  describe('startExitWithBurntTokens', async function() {
    beforeEach(async function() {
      contracts.ERC721Predicate = await deployer.deployErc721Predicate()
      const { rootERC721, childErc721 } = await deployer.deployChildErc721(accounts[0])
      childContracts.rootERC721 = rootERC721
      childContracts.childErc721 = childErc721
    })

    it('Valid exit with burnt tokens', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC721,
        user,
        tokenId
      )
      const { receipt } = await childContracts.childErc721.withdraw(tokenId)
      let { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts, start)
      const startExitTx = await utils.startExitWithBurntTokens(
        contracts.ERC721Predicate,
        { headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 }
      )
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC721.address,
        isRegularExit: true
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })
  })

  describe('startExit', async function() {
    beforeEach(async function() {
      contracts.ERC721Predicate = await deployer.deployErc721Predicate()
      const { rootERC721, childErc721 } = await deployer.deployChildErc721(accounts[0])
      childContracts.rootERC721 = rootERC721
      childContracts.childErc721 = childErc721
    })

    it('reference: incomingTransfer - exitTx: burn', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC721,
        other,
        tokenId
      )

      const { receipt } = await childContracts.childErc721.transferFrom(other, user, tokenId, { from: other })
      const { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts)

      const { receipt: r } = await childContracts.childErc721.withdraw(tokenId)
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExit(contracts.ERC721Predicate, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC721.address
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })

    it('reference: Deposit - exitTx: burn', async function() {
      const { receipt } = await childContracts.childChain.depositTokens(childContracts.rootERC721.address, user, tokenId, '1' /* mock depositBlockId */)
      const { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts)

      const { receipt: r } = await childContracts.childErc721.withdraw(tokenId)
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExit(contracts.ERC721Predicate, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC721.address
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })

    it('reference: counterparty balance (Transfer) - exitTx: incomingTransfer', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC721,
        user,
        tokenId
      )

      // proof of counterparty's balance
      const { receipt } = await childContracts.childErc721.transferFrom(user, other, tokenId)
      const { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts)

      // treating this as in-flight incomingTransfer
      const { receipt: r } = await childContracts.childErc721.transferFrom(other, user, tokenId, { from: other })
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExit(contracts.ERC721Predicate, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC721.address
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })
  })

  describe('verifyDeprecation', async function() {
    it('write test')
  })

  describe('ERC721PlasmaMintable', async function() {
    beforeEach(async function() {
      predicate = await deployer.deployErc721Predicate()
      const { rootERC721, childErc721 } = await deployer.deployChildErc721Mintable()
      // add ERC721Predicate as a minter
      await rootERC721.addMinter(predicate.address)
      childContracts.rootERC721 = rootERC721
      childContracts.childErc721 = childErc721
    })

    it('mint and burn on the side chain', async function() {
      const tokenId = '0x' + crypto.randomBytes(32).toString('hex')
      const { receipt: r } = await childContracts.childErc721.mint(user, tokenId)
      let mintTx = await web3Child.eth.getTransaction(r.transactionHash)
      mintTx = await buildInFlight(mintTx)
      await childContracts.childErc721.transferFrom(user, other, tokenId)

      const { receipt } = await childContracts.childErc721.withdraw(tokenId, { from: other })
      // the token doesnt exist on the root chain as yet
      expect(await childContracts.rootERC721.exists(tokenId)).to.be.false

      let { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts, start)
      const startExitTx = await startExitWithBurntMintableToken(
        { headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 },
        mintTx,
        other // exitor - account to initiate the exit from
      )
      // console.log(startExitTx)
      expect(await childContracts.rootERC721.exists(tokenId)).to.be.true
      expect((await childContracts.rootERC721.ownerOf(tokenId)).toLowerCase()).to.equal(contracts.depositManager.address.toLowerCase())

      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: other,
        token: childContracts.rootERC721.address,
        isRegularExit: true
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })

    it('mint, MoreVP exit with reference: counterparty balance (Transfer) and exitTx: incomingTransfer', async function() {
      const tokenId = '0x' + crypto.randomBytes(32).toString('hex')
      const { receipt: mint } = await childContracts.childErc721.mint(user, tokenId)
      const mintTx = await buildInFlight(await web3Child.eth.getTransaction(mint.transactionHash))

      // proof of counterparty's balance
      const { receipt } = await childContracts.childErc721.transferFrom(user, other, tokenId)
      const { block, blockProof, headerNumber, reference } = await init(contracts.rootChain, receipt, accounts)

      // treating this as in-flight incomingTransfer
      const { receipt: r } = await childContracts.childErc721.transferFrom(other, user, tokenId, { from: other })
      let exitTx = await buildInFlight(await web3Child.eth.getTransaction(r.transactionHash))

      // the token doesnt exist on the root chain as yet
      expect(await childContracts.rootERC721.exists(tokenId)).to.be.false

      const startExitTx = await startMoreVpExitWithMintableToken(
        headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx, mintTx, user)

      expect(await childContracts.rootERC721.exists(tokenId)).to.be.true
      expect((await childContracts.rootERC721.ownerOf(tokenId)).toLowerCase()).to.equal(contracts.depositManager.address.toLowerCase())
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC721.address
      })
      utils.assertBigNumberEquality(log.args.amount, tokenId)
    })
  })
})

function startExitWithBurntMintableToken(input, mintTx, from) {
  return predicate.startExitWithBurntTokens(
    ethUtils.bufferToHex(ethUtils.rlp.encode(utils.buildReferenceTxPayload(input))),
    ethUtils.bufferToHex(mintTx),
    { from }
  )
}

function startMoreVpExitWithMintableToken(
  headerNumber, blockProof, blockNumber, blockTimestamp, reference, logIndex, exitTx, mintTx, from) {
  return predicate.startExitAndMint(
    ethUtils.bufferToHex(
      ethUtils.rlp.encode([
        headerNumber,
        ethUtils.bufferToHex(Buffer.concat(blockProof)),
        blockNumber,
        blockTimestamp,
        ethUtils.bufferToHex(reference.transactionsRoot),
        ethUtils.bufferToHex(reference.receiptsRoot),
        ethUtils.bufferToHex(reference.receipt),
        ethUtils.bufferToHex(ethUtils.rlp.encode(reference.receiptParentNodes)),
        ethUtils.bufferToHex(ethUtils.rlp.encode(reference.path)), // branch mask,
        logIndex
      ])
    ),
    ethUtils.bufferToHex(exitTx),
    ethUtils.bufferToHex(mintTx),
    { from, value: web3.utils.toWei('.1', 'ether') }
  )
}

async function init(rootChain, receipt, accounts) {
  const event = {
    tx: await web3Child.eth.getTransaction(receipt.transactionHash),
    receipt: await web3Child.eth.getTransactionReceipt(receipt.transactionHash),
    block: await web3Child.eth.getBlock(receipt.blockHash, true /* returnTransactionObjects */)
  }

  const blockHeader = getBlockHeader(event.block)
  const headers = [blockHeader]
  const tree = new MerkleTree(headers)
  const root = ethUtils.bufferToHex(tree.getRoot())
  const end = event.tx.blockNumber
  const blockProof = await tree.getProof(blockHeader)
  start = Math.min(start, end)
  tree
    .verify(blockHeader, event.block.number - start, tree.getRoot(), blockProof)
    .should.equal(true)
  const { vote, sigs, extraData } = utils.buildSubmitHeaderBlockPaylod(accounts[0], start, end, root)
  const submitHeaderBlock = await rootChain.submitHeaderBlock(vote, sigs, extraData)

  const txProof = await getTxProof(event.tx, event.block)
  assert.isTrue(verifyTxProof(txProof), 'Tx proof must be valid (failed in js)')
  const receiptProof = await getReceiptProof(event.receipt, event.block, web3Child)
  assert.isTrue(verifyReceiptProof(receiptProof), 'Receipt proof must be valid (failed in js)')

  const NewHeaderBlockEvent = submitHeaderBlock.logs.find(log => log.event === 'NewHeaderBlock')
  start = end + 1
  return { block: event.block, blockProof, headerNumber: NewHeaderBlockEvent.args.headerBlockId, reference: await build(event) }
}
