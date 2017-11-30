function parseStatString ( statString ) {
  var json = {}

  statString.split( '\n' ).forEach( function ( line ) {
    var parts = line.split( ' ' )
    var key = parts[ 0 ]
    var value = parts[ 1 ]

    var number = Number( value )

    json[ key ] = isNaN( number ) ? value : number
  } )

  return json
}

module.exports = parseStatString
