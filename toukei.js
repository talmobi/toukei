// <metricname>:<value>|<type>

// metric types
// https://github.com/etsy/statsd/blob/master/docs/metric_types.md
//
// sampling:    c -- counter
// timing:      ms -- milliseconds
// gauges       g -- gague
// sets:        s

var createAgent = require( './agent.js' )
var createServer = require( './server.js' )

module.exports = {
  createAgent: createAgent,
  createServer: createServer
}

