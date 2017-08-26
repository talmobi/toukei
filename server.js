var http = require( 'http' )

var express = require( 'express' )
var bodyParser = require( 'body-parser' )

var parseLine = require( './parse-line.js' )

var MAX_METRICS_BEFORE_FLUSH = 1000

function aggregate ( options ) {
  var statString = ''

  console.log( ' ==================== ' )
  console.log( ' === toukei stats === ' )

  var cache = options.cache

  // aggregate counters
  var counters = cache.counters
  for ( key in counters ) {
    var value = counters[ key ]

    // calculate "per second" rate
    var valuePerSecond = ( value / ( options.flushInterval / 1000 ) )

    statString += ( 'stats.'        + key + ' ' + valuePerSecond + '\n' )
    statString += ( 'stats_counts.' + key + ' ' + value          + '\n' )

    options.numStats += 1
  }

  // aggregate timers
  var timers = cache.timers
  for ( key in timers ) {
    if ( timers[ key ].length > 0 ) {
      var values = timers[ key ].sort(function ( a, b ) {
        return ( a.value - b.value )
      })

      var count = values.length

      var min = values[ 0 ]
      var max = values[ count - 1 ]

      var cumulativeValues = [ min ]
      for ( var i = 1; i < count; i++ ) {
        cumulativeValues.push(
          values[ i ] + cumulativeValues[ i - 1 ]
        )
      }

      var sum = min
      var mean = min
      var maxAtThreshold = max

      var message = ''

      var key2, pctThreshold = [ 90, 70, 50 ]

      for ( key2 in pctThreshold ) {
        var pct = pctThreshold[ key2 ]

        if ( count > 1 ) {
          var thresholdIndex = Math.round( ( ( 100 - pct ) / 100 ) * count )
          var numInThreshold = ( count - thresholdIndex )

          maxAtThreshold = values[ numInThreshold - 1 ]
          sum = cumulativeValues[ numInThreshold - 1 ]
          mean = ( sum / numInThreshold )
        }

        var clean_pct = '' + pct
        clean_pct.replace( '.', '_' )
        message += 'stats.timers.' + key + '.mean_' +  clean_pct + ' ' + mean + '\n'
        message += 'stats.timers.' + key + '.upper_' + clean_pct + ' ' + maxAtThreshold + '\n'
        message += 'stats.timers.' + key + '.sum_' +   clean_pct + ' ' + sum + '\n'
      }

      sum = cumulativeValues[ count - 1 ]
      mean = ( sum / count )

      message += 'stats.timers.' + key + '.upper ' +  max   + '\n';
      message += 'stats.timers.' + key + '.lower ' +  min   + '\n';
      message += 'stats.timers.' + key + '.count ' +  count + '\n';
      message += 'stats.timers.' + key + '.sum ' +    sum   + '\n';
      message += 'stats.timers.' + key + '.mean ' +   mean  + '\n';
      statString += message

      options.numStats += 1
    }
  }

  // aggregate gauges
  var gauges = cache.gauges
  for ( key in gauges ) {
    statString += ( 'stats.gauges.' + key + ' ' + gauges[ key ] + '\n' )
    options.numStats += 1
  }

  // clear cache
  options.cache.counters = {}
  options.cache.timers = {}
  options.cache.gauges = {}

  console.log( statString )
  console.log( ' === ' + ( new Date() ) + ' === ' )
  console.log( ' ==================== \n' )

  // TODO push/send somewhere else?

  // return aggregated data
  return statString
}

function schedule ( options ) {
  aggregate( options )

  setTimeout( function () {
    schedule( options )
  }, 1000 * 10 )
}

function createServer ( options ) {
  options = options || {}

  var cache = options.cache = {
    counters: {},
    timers: {},
    gauges: {}
  }

  options.numStats = 0

  options.port = options.port || 3355
  options.flushInterval = options.flushInterval || ( 1000 * 10 )

  var app = express()
  var server = http.createServer( app )

  app.use( function ( req, res, next ) {
    console.log( 'incoming request from: ' + req.ip )
    next()
  })

  app.use( bodyParser.text(), function ( req, res ) {
    // console.log( req.body )

    // console.log( 'giraffe header: ' + req.headers.giraffe )

    var metrics = parseLine( req.body )

    metrics.forEach( function ( metric ) {
      var name = metric.name
      var value = metric.value
      var type = metric.type

      var timestamp = metric.timestamp

      switch ( type ) {
        case 'c': // counters
          cache.counters[ name ] = ( cache.counters[ name ] || 0 )
          cache.counters[ name ] += Number( value )
          break

        case 'ms': // timers
          cache.timers[ name ] = ( cache.timers[ name ] || [] )
          cache.timers[ name ].push( Number( value ) )
          break

        case 'g': // gauges
          cache.gauges[ name ] = ( cache.gauges[ name ] || 0 )
          switch ( value[ 0 ] ) {
            case '+':
              cache.gauges[ name ] += Number( value )
              break

            case '-':
              cache.gauges[ name ] -= Number( value )
              break

            default:
              cache.gauges[ name ] = Number( value )
          }
          break

        default:
          throw new Error( 'unrecognized metric type: ' + type )
      }
    })

    res.status( 200 ).end()
  })

  server.listen( options.port, function () {
    console.log( 'toukei server listening on port: ' + server.address().port )
    schedule( options ) // start flushing
  })
}

module.exports = createServer
