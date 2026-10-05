const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeMetrics,computeMetricDeltas}=require('../app/analytics/metrics');
const {normalizeInsightData}=require('../adapters/threadsInsightsAdapter');
test('unavailable/null/empty metrics are not fabricated as zero',()=>{
 assert.deepEqual(normalizeMetrics({views:null,likes:'',comments:false,shares:0}),{shares:0,interactions:0});
 assert.deepEqual(normalizeInsightData([{name:'views',total_value:{value:null}},{name:'likes',values:[{value:null}]},{name:'shares',total_value:{value:0}}]).metrics,{shares:0});
 assert.deepEqual(computeMetricDeltas({views:10},{views:null}),{deltas:{},rates:{}});
 assert.deepEqual(normalizeMetrics({views:' ',likes:[1],comments:{},shares:'0'}),{shares:0,interactions:0});
});
