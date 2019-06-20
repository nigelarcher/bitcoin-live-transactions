const txdebug = require('debug')('blt:tx')
const hashdebug = require('debug')('blt:hash')
const blockdebug = require('debug')('blt:blockchain')

var Socket = require('blockchain.info/Socket')

const EventEmitter = require('events').EventEmitter

module.exports = (config) => {
  const blockexplorer = require('blockchain.info/blockexplorer').usingNetwork(config.testnet ? 3 : 0)
  const self = this
  self.connected = false
  self.events = new EventEmitter()
  self.getTxs = async (address) => (await blockexplorer.getAddress(address)).txs
  self.getBalance = async (address) => (await blockexplorer.getAddress(address)).final_balance
  self.getAddress = async (address) => {
    const result = {}
    blockdebug('Getting txs for address', address, 'url:', self.api_url + 'txs/?address=' + address)
    result.address = address
    result.in = 0
    result.out = 0
    result.curr = 'bits(uBTC)'
    const response = await blockexplorer.getAddress(address)
    console.log(response)
    response.txs.forEach(eachTx => {
      eachTx.out.forEach(eachOut => {
        eachOut.scriptPubKey.addresses.forEach(outaddress => {
          if (outaddress === address) {
            result.in = result.in + eachOut.value
          }
        })
      })
      eachTx.inputs.forEach(eachIn => {
        if (eachIn.addr === address) {
          result.out = result.out + eachIn.value
        }
      })
    })
    result.balance = result.in - result.out
    result.txs = response.txs.length
  }
  self.socket = new Socket({ network: config.testnet ? 3 : 0 })
  self.connect = async () => {
    self.socket.onOpen(() => {
      self.connected = true
      self.socket.emit('subscribe', 'inv')
      self.events.emit('connected')
    })
    self.watchingAddresses = []
    self.watchAddress = address => {
      self.watchingAddresses.push(address)
    }
    self.getTxConfirmation = async (tx, payment) => {
      const loaded = await blockexplorer.getTx(tx.hash)
      if (self.latestBlock) {
        if (self.latestBlock.height - loaded.block_height > 6 && !loaded.double_spend) {
          self.events.emit('confirmed', payment)
          return
        } else if (loaded.double_spend) {
          self.events.emit('doubleSpend', payment)
          return
        }
      }
      // Still not confirm.. call back in 12 minutes
      setTimeout(self.getTxConfirmation, 12 * 60 * 1000, tx, payment)
    }
    self.socket.onTransaction((data) => {
      self.events.emit('tx', data)
      data.out.forEach(eachVout => {
        if (self.watchingAddresses.includes(eachVout.addr)) {
          hashdebug({ hash: data.hash, address: eachVout.addr, amount: eachVout.value })
          const payment = { hash: data.hash, address: eachVout.addr, amount: eachVout.value }
          self.events.emit(eachVout.addr, payment)
          // check for confirmations on the block in about 30 minutes (takes about 60 minutes to get full confirmation)
          setTimeout(self.getTxConfirmation, 30 * 60 * 1000, data, payment)
        }
      })
      txdebug('New transaction received: ' + JSON.stringify(data))
    })
    self.latestBlock = null
    self.socket.onBlock((data) => {
      self.latestBlock = data
      self.events.emit('block', data)
      blockdebug('New block received: ' + JSON.stringify(data))
    })
  }
  return self
}
