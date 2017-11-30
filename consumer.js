var parseLines = require( './parse-lines.js' )

var parseStatString = require( './parse-stat-string.js' )

var FLUSH_STORAGE_TIME = ( 1000 * 60 * 15 ) // 15 mins

function stats ( opts ) {
  var statString = ''

  var now = Date.now()
  statString += ( 'stats.timestamp ' + now + '\n' )

  var numStats = 0
  var interval = ( opts.interval || opts.flushInterval )
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

  // return aggregated data
  return {
    numStats: numStats,
    statString: statString
  }
}

function consumer ( options ) {
  options = options || {}
  options.listeners = {}

  options.cache = {
    counters: {},
    timers: {},
    gauges: {}
  }

  options.numStats = 0
  options.flushCounter = 0

  options.interval = options.interval || ( 1000 * 10 )

  var storageMaxLength = ( ( options.storageTime || FLUSH_STORAGE_TIME ) / ( options.interval ) )
  var storageBufferLength = ( 10 ) // buffer for 10 flush intervals before splicing/capping the size back
  var storageResizeThresholdLength = ( storageMaxLength + storageBufferLength )

  options.storageMaxLength = storageMaxLength
  options.storageBufferLength = storageBufferLength
  options.storageResizeThresholdLength = storageResizeThresholdLength

  options.storage = []

  var api = {}
  options.api = api

  api.on = function ( evt, callback ) {
    options.listeners[ evt ] = options.listeners[ evt ] || []

    options.listeners[ evt ].push( callback )

    // return off function
    return function off () {
      var i = options.listeners[ evt ].indexOf( callback )
      return options.listeners[ evt ].splice( i, 1 )
    }
  }

  api._parseLines = parseLines

  api.parseStatString = parseStatString

  api.feed = function ( text, cache ) {
    cache = ( cache || options.cache )
    var metrics = parseLines( text )

    for ( var i = 0; i < metrics.length; ++i ) {
      var metric = metrics[ i ]

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
          }
          break

        case 'ms': // timers
          if ( isNumber ) {
            cache.timers[ name ] = ( cache.timers[ name ] || [] )
            cache.timers[ name ].push( value )
          }
          break

        case 'g': // gauges
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
    }

    return true
  }

  api.stats = function ( opts ) {
    return stats( opts || options )
  }

  api.clear = function ( opts ) {
    opts = ( opts || options )

    // clear cache
    opts.cache.counters = {}
    opts.cache.timers = {}
    opts.cache.gauges = {}
  }

  api.push = function ( stats, opts ) {
    opts = ( opts || options )
    opts.storage.push( stats.statString )

    var surplus = ( opts.storage.length - opts.storageMaxLength )

    if ( surplus > opts.storageBufferLength ) {
      // if size is at its threshold limit, cut off the extra values
      opts.storage.splice( 0, surplus ) // mutable
      console.log( '[toukei] clamped storage size' )
    }
  }

  api.slice = function ( x, y ) {
    return options.storage.slice( x, y )
  }

  api.emit = function ( evt, data, opts ) {
    opts = ( opts || options )

    if ( opts.listeners[ evt ] ) {
      opts.listeners[ evt ].forEach( function ( callback ) {
        callback( data )
      } )
    }
  }

  // shorthand for stats and clear, return stats
  api.flush = function ( opts ) {
    opts = ( opts || options )

    var stats = api.stats( opts )
    api.clear( opts )

    opts.numStats += stats.numStats
    opts.flushCounter++

    return stats
  }

  return api
}

consumer.parseStatString = parseStatString

module.exports = consumer
