// <metricname>:<value>|<type>

// metric types
// https://github.com/etsy/statsd/blob/master/docs/metric_types.md
//
// sampling:    c -- counter
// timing:      ms -- milliseconds
// gauges       g -- gague
// sets:        s

var dreq = require( 'dasu' ).req

var parseLine = require( './parse-line.js' )

// heavily inspired by statsd
function createAgent ( options ) {
  options = options || {}
  var address = {}

  // resolve address
  var bhost, bport, bprotocol
  if ( typeof window === 'object' && window.location ) {
    bhost = ( window.localhost.host || window.location.hostname )
    bprotocol = window.location.protocol

    if ( bprotocol.indexOf( 'https' ) !== -1 ) {
      bport = 443 // default https port
    } else {
      bport = 80 // default http port
    }

    bport = window.location.port || bport // override defaults if specified
  }

  address.host = ( options.host || bhost || 'localhost' )
  address.port = ( options.port || bport || 3355 )
  address.protocol = ( options.protocol || bprotocol || 'http' )

  address.method = 'POST'
  address.path = '/api/toukei'

  options.flushInterval = ( options.flushInterval || 333 )

  var lines = []

  // aggregate metrics and send to backend service
  function flush () {
    // TODO send to server

    if ( lines.length > 0 ) {
      dreq({
        method: 'POST',

        protocol: address.protocol,

        host: address.host,
        port: address.port,
        path: address.path,

        headers: options.headers || {},

        data: lines.join( '\n' )
      }, function ( err, res, body ) {
        if ( err ) {
          if ( !options.silent ) {
            console.log( err )
          }
        } else {
          if ( options.verbose ) {
            console.log(
              'toukei agent: req sent, res.statusCode: ' + res.statusCode
            )
          }
        }
      })
    }
  }

  function scheduleNextFlush () {
    flush()

    // clear metrics
    lines.length = 0

    setTimeout( scheduleNextFlush, options.flushInterval )
  }
  scheduleNextFlush()

  var api = {}
  api.send = function ( metric ) {
    var metrics = parseLine( metric )

    metrics.forEach(function ( metric ) {
      lines.push( metric.rawLine )
    })
  }

  return api
}

function isValidLineProtocol ( line ) {
  try {
    var metrics = parseLine( line )
    return true
  } catch ( err ) {
    return false
  }
}

module.exports = createAgent
