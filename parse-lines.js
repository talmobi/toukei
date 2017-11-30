function parseLines ( line ) {
  if ( typeof line !== 'string' ) {
    console.log( line )
    throw new Error( 'Invalid line protocol -- failed to parse' )
  }

  var metrics = []

  line = line.trim()

  var lines = line.split( '\n' )

  if ( !line.length ) return []

  lines.forEach(function ( line ) {
    var parts = line.split( /[:|]/ )

    var name = parts[ 0 ]
    var value = parts[ 1 ]
    var type = parts[ 2 ]

    var sampling = parts[ 3 ] // optional
    if ( sampling ) throw new Error( 'sampling not yet implemented' ) // TODO

    var timestamp = Date.now()

    switch ( type ) {
      case 'c':
      case 'ms':
      case 'g':
        // valid type's
        break

      default:
        throw new Error( 'unrecognized metric type: ' + type )
    }

    metrics.push({
      name: name,
      value: value,
      type: type,
      sampling: sampling,
      timestamp: timestamp,
      rawLine: line
    })
  })

  return metrics
}

module.exports = parseLines
