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
var createConsumer = require( './consumer.js' )

var parseLines = require( './parse-lines.js' )
var parseStatString = require( './parse-stat-string.js' )

module.exports = {
  createAgent: createAgent,
  agent: createAgent,

  createServer: createServer,
  server: createServer,

  createConsumer: createConsumer,
  consumer: createConsumer,

  parseStatString: parseStatString,
  parseLines: parseLines
}
