var http = require( 'http' )

var express = require( 'express' )
var bodyParser = require( 'body-parser' )
var cors = require( 'cors' )

var parseLine = require( './parse-line.js' )

var MAX_METRICS_BEFORE_FLUSH = 1000

function parseStatString ( statString ) {
  var map = {}
  statString.split( '\n' ).forEach( function ( line ) {
    var parts = line.split( ' ' )
    var key = parts[ 0 ]
    var value = parts[ 1 ]

    var number = Number( value )

    map[ key ] = isNaN( number ) ? value : number
  })

  return map
}

function aggregate ( options ) {
  var statString = ''

  console.log()
  console.log( ' ==================== ' )
  console.log( ' === toukei stats === ' )

  var cache = options.cache

  // aggregate counters
  var counters = cache.counters

  for ( key in counters ) {
    var value = counters[ key ]

    // calculate "per second" rate
    var valuePerSecond = ( value / ( options.flushInterval / 1000 ) )

    statString += ( 'stats.counters.' + key + '.rate ' +   valuePerSecond + '\n' )
    statString += ( 'stats.counters.' + key + '.count ' +  value          + '\n' )

    options.numStats += 1
  }

  // aggregate timers
  var timers = cache.timers

  for ( key in timers ) {
    if ( timers[ key ].length > 0 ) {
      var values = timers[ key ].sort(function ( a, b ) {
        return ( a - b )
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

      var key2, pctThreshold = ( options.pctThreshold || [ 90 ] )

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
  options.io && options.io.emit(
    'flush',
    parseStatString( statString )
  )

  // TODO cache stats?
  cache.storage = (
    cache.storage ||
    require( 'short-storage' ).createTubeStorage({
      ttl: 1000 * 60 * 15, // default ttl 15 min
      max_length: 255 // but cap it at a reasonable limit
    })
  )

  cache.storage.push({
    timestamp: Date.now(),
    statString: statString
  })

  // return aggregated data
  return statString
}

function scheduleFlush ( options ) {
  aggregate( options )

  options.running && setTimeout( function () {
    scheduleFlush( options )
  }, options.flushInterval )
}

function calculateSnapshot ( options ) {
  var snapshots = options.snapshots

  var results = {
    counters: {},
    timers: {},
    gauges: {}
  }

  var metricNames = {}

  for ( type in results ) {
    var snapshot = options.snapshots[ type ] // counters, timers, gauges

    for ( key in snapshot ) {
      if ( snapshot[ key ].length > 0 ) {
        metricNames[ key ] = true

        var values = snapshot[ key ]
        var count = values.length

        var sum = 0
        for ( var i = 0; i < count; i++ ) {
          var value = values[ i ]
          sum += value
        }

        var avg = Number( sum / count )

        if ( typeof avg === 'number' && Number.isNaN( avg ) === false ) {
          results[ type ][ key ] = avg
        } else {
          // probably string value - simply report latest/last value
          results[ type ][ key ] = values[ count - 1 ]
        }
      }
    }
  }

  options.io && options.io.volatile.emit( 'snapshot', results )

  // Object.keys( metricNames ).forEach( function ( name ) {
  //   var counter = results.counters[ name ]
  //   var timer = results.timers[ name ]
  //   var gauge = results.gauges[ name ]

  //   var data = {}
  //   if ( counter != null ) data.counter = counter
  //   if ( timer != null ) data.timer = timer
  //   if ( gauge != null ) data.gauge = gauge

  //   console.log( 'emitting: ' + name )
  //   console.log( data )
  //   console.log( ' - - - - - - - - - - ' )

  //   options.io && options.io.emit( name, data )
  // })

  // clear snapshots
  options.snapshots.counters = {}
  options.snapshots.timers = {}
  options.snapshots.gauges = {}

  /*
  var counters = snapshots.counters
  for ( key in counters ) {
    if ( counters[ key ].length > 0 ) {
      var values = counters[ key ]
      var count = values.length

      var sum = 0
      for ( var i = 0; i < count; i++ ) {
        var value = values[ i ]
        sum += value
      }

      var avg = Number( sum / count )

      if ( typeof avg === 'number' && Number.isNaN( avg ) === false ) {
        results.counters[ key ] = avg
      } else {
        // probably string value - simply report latest/last value
        results.counters[ key ] = values[ count - 1 ]
      }
    }
  }

  var timers = snapshots.timers
  for ( key in timers ) {
    if ( timers[ key ].length > 0 ) {
      var values = timers[ key ]
      var count = values.length

      var sum = 0
      for ( var i = 0; i < count; i++ ) {
        var value = values[ i ]
        sum += value
      }

      var avg = Number( sum / count )

      if ( typeof avg === 'number' && Number.isNaN( avg ) === false ) {
        results.timers[ key ] = avg
      } else {
        // probably string value - simply report latest/last value
        results.timers[ key ] = values[ count - 1 ]
      }
    }
  }

  var gauges = snapshots.gauges
  for ( key in gauges ) {
    if ( gauges[ key ].length > 0 ) {
      var values = gauges[ key ]
      var count = values.length

      var sum = 0
      for ( var i = 0; i < count; i++ ) {
        var value = values[ i ]
        sum += value
      }

      var avg = Number( sum / count )

      if ( typeof avg === 'number' && Number.isNaN( avg ) === false ) {
        results.gauges[ key ] = avg
      } else {
        // probably string value - simply report latest/last value
        results.gauges[ key ] = values[ count - 1 ]
      }
    }
  }

  */
}

function scheduleSnapshot ( options ) {
  calculateSnapshot( options )

  options.running && setTimeout( function () {
    scheduleSnapshot( options )
  }, options.snapshotInterval )
}

function createServer ( options ) {
  options = options || {}

  options.running = true

  var cache = options.cache = {
    counters: {},
    timers: {},
    gauges: {}
  }

  // momentary snapshot averages
  var snapshots = options.snapshots = {
    counters: {},
    timers: {},
    gauges: {}
  }

  options.numStats = 0

  options.port = ( options.port || 3355 )
  options.host = ( options.host || '0.0.0.0' )

  options.flushInterval = options.flushInterval || ( 1000 * 10 )
  options.snapshotInterval = options.snapshotInterval || ( 1000 * 1 )

  // options.flushInterval = 1000

  var app = express()
  var server = http.createServer( app )
  var io = require( 'socket.io' )( server )

  options.app = app
  options.server = server
  options.io = io

  // Allow cors
  app.use( cors() )

  app.use( function ( req, res, next ) {
    if ( options.verbose ) {
      console.log( 'incoming request from: ' + req.ip )
    } else {
      process.stdout.write( '.' )
    }
    next()
  })

  app.post( '/api/toukei', bodyParser.text(), function ( req, res ) {
    // console.log( req.body )

    // console.log( 'giraffe header: ' + req.headers.giraffe )

    var metrics = parseLine( req.body )

    metrics.forEach( function ( metric ) {
      var name = metric.name
      var type = metric.type

      var timestamp = metric.timestamp


      var value = Number( metric.value )
      var isNumber = ( typeof value === 'number' && Number.isNaN( value ) === false )

      if ( !isNumber ) {
        value = metric.value // probably string?
      }

      switch ( type ) {
        case 'c': // counters
          if ( isNumber ) {
            cache.counters[ name ] = ( cache.counters[ name ] || 0 )
            cache.counters[ name ] += value

            snapshots.counters[ name ] = ( snapshots.counters[ name ] || [] )
            snapshots.counters[ name ].push( value )
          }
          break

        case 'ms': // timers
          if ( isNumber ) {
            cache.timers[ name ] = ( cache.timers[ name ] || [] )
            cache.timers[ name ].push( value )

            snapshots.timers[ name ] = ( snapshots.timers[ name ] || [] )
            snapshots.timers[ name ].push( value )
          }
          break

        case 'g': // gauges
          snapshots.gauges[ name ] = ( snapshots.gauges[ name ] || [] )
          snapshots.gauges[ name ].push( value )

          if ( isNumber ) {
            cache.gauges[ name ] = ( cache.gauges[ name ] || 0 )

            switch ( metric.value[ 0 ] ) {
              case '+':
                cache.gauges[ name ] += value
                break

              case '-':
                cache.gauges[ name ] -= value
                break

              default:
                cache.gauges[ name ] = value
            }
          } else {
            cache.gauges[ name ] = ( cache.gauges[ name ] || '' )
            cache.gauges[ name ] = value
          }
          break

        default:
          throw new Error( 'unrecognized metric type: ' + type )
      }
    })

    res.status( 200 ).end()
  })

  app.get( '/api/toukei/:limit', function ( req, res ) {
    var storage = options.cache && options.cache.storage
    if ( storage ) {
      var stats = storage.pull( req.params.limit || undefined )
      res.status( 200 ).json({
        statusCode: 200,
        message: 'success - got recent stats',
        stats: stats
      }).end()
    } else {
      res.status( 200 ).json({
        statusCode: 200,
        message: 'success - no stats seem to have been cached yet',
        stats: []
      }).end()
    }
  })

  io.on( 'connection', function ( socket ) {
    var len = io.clients().server.engine.clientsCount
    console.log( 'obapp server: socket client connected, sockets.length: ' + len )

    socket.on( 'disconnect', function () {
      var len = io.clients().server.engine.clientsCount
      console.log( 'obapp server: socket client disconnected, sockets.length: ' + len )
    })
  })

  server.listen( options.port, options.host, function () {
    console.log( 'toukei server listening on port: ' + server.address().port )
    scheduleFlush( options ) // start flushing
    scheduleSnapshot( options ) // start snapshots
  })

  return {
    close: function () {
      options.running = false
      server.close()
    },
    address: function () {
      return server.address()
    }
  }
}

module.exports = createServer
