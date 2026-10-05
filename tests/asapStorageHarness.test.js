const test=require('node:test');const assert=require('node:assert/strict');const {checkLocal}=require('../tools/asap-storage-integration');
test('real storage harness refuses remote/default-port targets',()=>{
 for(const u of ['postgresql://example.com:15432/asap_test_x','postgresql://localhost:5432/asap_test_x','postgresql://localhost/asap_test_x'])assert.throws(()=>checkLocal(u,['postgresql:'],5432),/LOOPBACK/);
 assert.equal(checkLocal('postgresql://127.0.0.1:15432/asap_test_x',['postgresql:'],5432).port,'15432');
});
