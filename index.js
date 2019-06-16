const io = require('socket.io-client')
const debug = require('debug')('blt')
const txdebug = require('debug')('blt:tx')
const hashdebug = require('debug')('blt:hash')
const blockdebug = require('debug')('blt:blockchain')
const request = require('axios')

const EventEmitter = require('events').EventEmitter

module.exports = (config) => {
  const self = this
  if (config === undefined) {
    self.insight_servers = ['https://insight.bitpay.com/', 'https://www.localbitcoinschain.com/', 'https://search.bitaccess.co/']
    self.insight_apis_servers = ['https://insight.bitpay.com/api/', 'https://www.localbitcoinschain.com/api/', 'https://search.bitaccess.co/insight-api/']
  } else {
    if (config.testnet === true) {
      self.insight_servers = ['https://test-insight.bitpay.com/']
      self.insight_apis_servers = ['https://test-insight.bitpay.com/api/']
    }
  }
  self.connected = false
  self.events = new EventEmitter()
  self.getTxs = async (address) => (await self.getAddress(address)).txs
  self.getBalance = async (address) => (await self.getAddress(address)).balance
  self.getAddress = async (address) => {
    const result = {}
    blockdebug('Getting txs for address', address, 'url:', self.api_url + 'txs/?address=' + address)

    result.address = address
    result.in = 0
    result.out = 0
    result.curr = 'bits(uBTC)'
    const response = await axios(self.api_url + 'txs/?address=' + address)
    blockdebug('success :)')
    console.log(response)
    var transaction_json = response.data
    transaction_json.txs.forEach(each_tx => {
      each_tx.vout.forEach(each_vout => {
        each_vout.scriptPubKey.addresses.forEach(outaddress => {
          // console.log('checking', outaddress)
          if (outaddress === address) {
            // console.log('adding!', each_vout.value)
            result.in = result.in + each_vout.value * 1000000
          }
        })
      })
      each_tx.vin.forEach(each_vin => {
        // each_vin.scriptPubKey.addresses.forEach(function(outaddress) {
        // console.log('checking', outaddress)
        if (each_vin.addr === address) {
          // console.log('adding!', each_vout.value)
          result.out = result.out + each_vin.value * 1000000
        }
        // })
      })
    })
    result.balance = result.in - result.out
    result.txs = transaction_json.txs.length
    return { txs: response.data, balance: result }
  }

  self.connect = async () => {
    return new Promise((resolve, reject) => {
      if (self.connected === false) {
        self.url = self.insight_servers.shift()
        self.api_url = self.insight_apis_servers.shift()
        if (self.url !== undefined) {
          self.socket = io(self.url)
          setTimeout(() => {
            if (self.connected === false) {
              debug('Could not connect, trying again...')
              self.socket.disconnect()
              self.connect()
            }
          }, 5000)

          self.socket.on('connect', function () {
            self.connected = true
            self.socket.emit('subscribe', 'inv')
            self.events.emit('connected')
            resolve()
          })
          self.socket.on('tx', function (data) {
            self.events.emit('tx', data)
            data.vout.forEach(eachVout => {
              hashdebug({ address: Object.keys(eachVout)[0], amount: eachVout[Object.keys(eachVout)[0]] })
              self.events.emit(Object.keys(eachVout)[0], { address: Object.keys(eachVout)[0], amount: eachVout[Object.keys(eachVout)[0]] })
            })
            txdebug('New transaction received: ' + JSON.stringify(data))
          })
          self.socket.on('block', function (data) {
            self.events.emit('block', data)
            blockdebug('New block received: ' + JSON.stringify(data))
          })
          self.socket.on('event', function (data) {
            debug('event', data)
          })
          self.socket.on('disconnect', function (d) {
            debug('disconnect!', d)
          })
          self.socket.on('error', function (e) {
            debug('error!', e)
          })
        } else {
          reject('Cannot reach any bitcoin insight server... no bitcoin transactions are being received.')
        }
      }
    })
  }
  return self
}
