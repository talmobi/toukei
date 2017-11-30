var http = require( 'http' )

var express = require( 'express' )
var bodyParser = require( 'body-parser' )
var cors = require( 'cors' )

var cpuTimer = require( 'cpu-timer' )

var createConsumer = require( './consumer.js' )

var parseStatString = require( './parse-stat-string.js' )

function print ( stats, params ) {
  stats = ( stats.statString || stats )

  console.log()

  if ( params.logFilter ) {
    console.log( ' === toukei stats === logFilter: [' + params.logFilter.join( ',' ) + ']' )
  } else {
    console.log( ' === toukei stats === ' )
  }

  var logString = stats

  var jsonStatString = parseStatString( stats )

  if ( params.logFilter ) {
    var lines = logString.split( '\n' ).filter( function ( line ) {
      var shouldKeep = false
      params.logFilter.forEach( function ( filter ) {
        if ( line.indexOf( filter ) >= 0 ) shouldKeep = true
      } )
      return shouldKeep
    } )
    logString = lines.join( '\n' )
  }

  console.log( logString )

  console.log( ' === ' + ( new Date( jsonStatString[ 'stats.timestamp' ] ) ) + ' === ' )

  console.log()
}

function schedule ( options, index ) {
  var consumer = options.consumers[ index ]
  var interval = options.intervals[ index ]

  var stats = consumer.flush()

  consumer.emit( 'flush', stats.statString )

  if ( options.running ) {
    clearTimeout( options._timeouts[ index ] )
    options._timeouts[ index ] = setTimeout( function () {
      schedule( options, index )
    }, interval )
  }
}

function scheduleSelfReport ( options ) {
  if ( options.clearCpuTimer ) options.clearCpuTimer()

  options.clearCpuTimer = cpuTimer.setInterval( function ( cpu ) {
    if ( options.running ) {
      options.consumers.forEach(
        function ( consumer ) {
          consumer.feed( 'toukei.cpuPercent:' + cpu.usage + '|g' )
          consumer.feed( 'toukei.system.cpuPercent:' + cpu.average + '|g' )
        }
      )
    } else {
      options.clearCpuTimer()
    }
  }, 1500 )
}

function createServer ( options ) {
  if ( typeof options === 'function' ) {
    callback = options
    options = {}
  }

  options = options || {}

  if ( typeof options.callback === 'function' ) callback = options.callback

  if ( options.port == null ) options.port = 3355

  options.host = ( options.host || '127.0.0.1' )

  options.intervals = options.intervals || [ 10 * 1000, 1000 ]

  if ( ! ( options.intervals instanceof Array ) ) {
    throw new Error( 'no options.intervals array found.' )
  }

  options.consumers = options.intervals.map( function ( interval, index ) {
    var consumer = createConsumer( { interval: interval } )

    consumer.on( 'flush', function ( statString ) {
      consumer.push( statString )

      if ( index === 0 ) {
        print( statString, options )
        options.io && options.io.emit( 'flush', statString )
      }

      options.io && options.io.emit( 'flush:' + index, statString )
    } )

    return consumer
  } )

  options._timeouts = {}

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
  } )

  app.post( '/api/toukei', bodyParser.text(), function ( req, res ) {
    var text = req.body

    options.consumers.forEach( function ( consumer ) {
      consumer.feed( text )
    } )

    res.status( 200 ).end()
  } )

  app.get( '/api/toukei/:index/:size', function ( req, res ) {
    var index= req.params.index
    var len = req.params.size

    if ( len >= 0 ) len = ( len * -1 )
    if ( len == 0 ) len = ( 10 )

    var consumer = options.consumers[ index ]

    if ( consumer && consumer.slice ) {
      var stats = consumer.slice( len )
      res.status( 200 ).json(
        {
          status: 200,
          message: 'got stats from index: ' + index,
          stats: stats
        }
      ).end()
    } else {
      res.status( 404 ).json(
        {
          status: 404,
          message: 'no consumer at that index ( ' + index + ' ) found'
        }
      ).end()
    }
  } )

  io.on( 'connection', function ( socket ) {
    console.log( 'obapp server: socket client connected, sockets.length: ' + io.clientsConnected )

    socket.on( 'disconnect', function () {
      console.log( 'obapp server: socket client disconnected, sockets.length: ' + io.clientsConnected )
    })
  } )

  var api = {
    close: function () {
      server.close()
    },

    start: start,

    address: function () {
      return server.address()
    },

    // underlying http server
    _server: server
  }

  server.on( 'close', function () {
    options.running = false
  } )

  function start ( callback ) {
    if ( options.running ) return

    server.listen( options.port, options.host, function () {
      options.running = true
      options.port = server.address().port

      console.log( 'toukei server listening on port: ' + server.address().port )

      options.consumers.forEach( function ( consumer, index ) {
        schedule( options, index )
      } )

      if ( !options.disableSelfReports ) scheduleSelfReport( options )

      api.options = Object.assign( {}, options )

      if ( typeof callback === 'function' ) {
        callback( null )
      }
    } )
  }

  server.on( 'error', function ( err ) {
    throw err
  } )

  return api
}

module.exports = createServer
