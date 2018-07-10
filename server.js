var http = require( 'http' )

var express = require( 'express' )
var bodyParser = require( 'body-parser' )
var cors = require( 'cors' )

var parseLine = require( './parse-line.js' )
var createAgent = require( './agent.js' )

var cpuTimer = require( 'cpu-timer' )

var FLUSH_STORAGE_TIME = ( 1000 * 60 * 60 ) // 1 hour

var MAX_STORAGE_LENGTH = ( FLUSH_STORAGE_TIME / ( 1000 * 10 ) )
var MAX_STORAGE_BUFFER_LENGTH = ( ( 1000 * 10 ) * 10 )
var MAX_STORAGE_LIMIT = ( MAX_STORAGE_LENGTH + MAX_STORAGE_BUFFER_LENGTH )

function parseStatString ( statString ) {
  var json = {}
  statString.split( '\n' ).forEach( function ( line ) {
    var parts = line.split( ' ' )
    var key = parts[ 0 ]
    var value = parts[ 1 ]

    var number = Number( value )

    json[ key ] = isNaN( number ) ? value : number
  })

  return json
}

function flush ( opts ) {
  var statString = ''

  var now = Date.now()
  statString += ( 'stats.timestamp ' + now + '\n' )

  var numStats = 0
  var interval = opts.interval
  var cache = opts.cache

  // aggregate counters
  var counters = cache.counters

  for ( key in counters ) {
    var value = counters[ key ]

    // calculate "per second" rate
    var valuePerSecond = ( value / ( interval / 1000 ) )

    statString += ( 'stats.counters.' + key + '.rate ' +   valuePerSecond + '\n' )
    statString += ( 'stats.counters.' + key + '.count ' +  value          + '\n' )

    numStats += 1
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

      var key2, pctThreshold = ( opts.pctThreshold || [ 95 ] )

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

      numStats += 1
    }
  }

  // aggregate gauges
  var gauges = cache.gauges

  for ( key in gauges ) {
    statString += ( 'stats.gauges.' + key + ' ' + gauges[ key ] + '\n' )
    numStats += 1
  }

  // clear cache
  // options.cache.counters = {}
  // options.cache.timers = {}
  // options.cache.gauges = {}

  // TODO push/send somewhere else?
  // options.io && options.io.emit(
  //   'flush',
  //   parseStatString( statString )
  // )

  // options.flushCounter++

  // options.storage.push( statString )

  // if ( options.storage.length > ( MAX_STORAGE_LIMIT ) ) {
  //   // if size is at its limit, cut off the extra values
  //   options.storage.splice( 0, MAX_STORAGE_BUFFER_LENGTH )
  // }

  // cache.storage && cache.storage.push({
  //   timestamp: Date.now(),
  //   statString: statString
  // })

  // return aggregated data
  return {
    numStats: numStats,
    statString: statString
  }
}

function condense ( options ) {
  // TODO?
}

function scheduleFlush ( options ) {
  var stats = flush({
    cache: options.cache,
    interval: options.flushInterval
  })

  // increment counters ( TODO not used for anything yet.. )
  options.flushCounter++
  options.numStats += stats.numStats

  // clear cache after flush
  options.cache.counters = {}
  options.cache.timers = {}
  options.cache.gauges = {}

  var jsonStatString = parseStatString( stats.statString )

  options.io && options.io.emit(
    'flush',
    jsonStatString
  )

  options.storage.push({
    statString: stats.statString,
    jsonStatString: jsonStatString
  })

  if ( options.storage.length > ( MAX_STORAGE_LIMIT ) ) {
    // if size is at its limit, cut off the extra values
    options.storage.splice( 0, MAX_STORAGE_BUFFER_LENGTH )
    console.log( 'cut off extra flushes from storage' )
  }

  // console log it
  console.log()
  // console.log( ' ==================== ' )

  if ( options.logFilter ) {
    console.log( ' === toukei stats === logFilter: [' + options.logFilter.join( ',' ) + ']' )
  } else {
    console.log( ' === toukei stats === ' )
  }

  var logString = stats.statString

  if ( options.logFilter ) {
    var lines = logString.split( '\n' ).filter( function ( line ) {
      var shouldKeep = false
      options.logFilter.forEach( function ( filter ) {
        if ( line.indexOf( filter ) >= 0 ) shouldKeep = true
      } )
      return shouldKeep
    } )
    logString = lines.join( '\n' )
  }
  console.log( logString )

  console.log( ' === ' + ( new Date( jsonStatString[ 'stats.timestamp' ] ) ) + ' === ' )
  // console.log( ' ==================== ' )
  console.log()

  if ( options.running ) {
    clearTimeout( options._flushTimeout )
    options._flushTimeout = setTimeout( function () {
      scheduleFlush( options )
    }, options.flushInterval )
  }
}

function scheduleSelfReport ( options ) {
  if ( options.clearCpuTimer ) options.clearCpuTimer()

  options.statsAgent = (
    options.statsAgent ||
    createAgent({
      host: options.host,
      port: options.port
    })
  )

  options.clearCpuTimer = cpuTimer.setInterval( function ( cpu ) {
    if ( options.running ) {
      // console.log( 'toukei.cpuPercent: ' + cpu.usage )
      options.statsAgent.send(
        'toukei.cpuPercent:' + cpu.usage + '|ms'
      )
      options.statsAgent.send(
        'toukei.system.cpuPercent:' + cpu.average + '|ms'
      )
    } else {
      options.clearCpuTimer()
    }
  }, 1000 )
}

function scheduleSnapshot ( options ) {
  var stats = flush({
    cache: options.snapshotCache,
    interval: options.snapshotInterval
  })

  // clear snapshot cache after flush
  options.snapshotCache.counters = {}
  options.snapshotCache.timers = {}
  options.snapshotCache.gauges = {}

  var jsonStatString = parseStatString( stats.statString )

  options.io && options.io.emit(
    'snapshot',
    jsonStatString
  )

  if ( options.running ) {
    clearTimeout( options._snapshotTimeout )
    options._snapshotTimeout = setTimeout( function () {
      scheduleSnapshot( options )
    }, options.snapshotInterval )
  }
}

function createServer ( options, callback ) {
  if ( typeof options === 'function' ) {
    callback = options
    options = {}
  }

  options = options || {}

  if ( typeof options.callback === 'function' ) callback = options.callback

  if ( typeof callback !== 'function' ) {
    throw new Error( 'no callback function found!' )
  }

  var cache = options.cache = {
    counters: {},
    timers: {},
    gauges: {}
  }

  // momentary snapshot averages
  var snapshots = options.snapshotCache = {
    counters: {},
    timers: {},
    gauges: {}
  }

  options.numStats = 0

  if ( options.port == null ) options.port = 3355

  options.host = ( options.host || '127.0.0.1' )

  options.flushCounter = 0

  options.flushInterval = options.flushInterval || ( 1000 * 10 )
  options.snapshotInterval = options.snapshotInterval || ( 1000 * 1 )

  if ( options.flushInterval <= options.snapshotInterval ) {
    var msg = (
      'options.flushInterval was set lower than options.snapshotInterval' +
      '. This is unintended behaviour.'
    )
    throw new Error( msg )
  }

  MAX_STORAGE_LENGTH = ( FLUSH_STORAGE_TIME / ( options.flushInterval ) )
  MAX_STORAGE_BUFFER_LENGTH = ( 10 ) // buffer for 10 flush intervals before splicing
  MAX_STORAGE_LIMIT = ( MAX_STORAGE_LENGTH + MAX_STORAGE_BUFFER_LENGTH )

  options.storage = []

  var app = express()
  var server = http.createServer( app )
  var io = require( 'kiite' )( server )

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
    var len = io.clientsConnected
    console.log( 'obapp server: socket client connected, sockets.length: ' + len )

    socket.on( 'disconnect', function () {
      var len = io.clientsConnected
      console.log( 'obapp server: socket client disconnected, sockets.length: ' + len )
    })
  })

  var api = {
    close: function () {
      options.running = false
      server.close()
    },

    address: function () {
      return server.address()
    },

    // underlying http server
    _server: server
  }

  server.on( 'close', function () {
    options.running = false
  } )

  server.listen( options.port, options.host, function () {
    options.running = true
    options.port = server.address().port

    console.log( 'toukei server listening on port: ' + server.address().port )

    scheduleFlush( options ) // start flushing
    scheduleSnapshot( options ) // start snapshots

    if ( !options.disableSelfReports ) scheduleSelfReport( options )

    api.options = Object.assign( {}, options )

    if ( typeof callback === 'function' ) {
      callback( null, api )
    }
  } )

  server.on( 'error', function ( err ) {
    if ( typeof callback === 'function' ) {
      callback( err )
    }
  } )

  return api // backwards compatability
}

module.exports = createServer
