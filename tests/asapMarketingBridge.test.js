const test=require('node:test');const assert=require('node:assert/strict');
const {prepareVariant}=require('../app/asap/marketingBridge');
const wave=require('../content/first_wave.json');
const binding={brandId:'asap_gta6',platform:'threads',accountKey:'asap_gta6:threads',platformUserId:'fixture',apiVerified:true,verifiedAt:new Date().toISOString()};
test('first-wave bridge refuses unverified destinations and preserves exact reviewed copy',()=>{
 const input={wave,variantId:'G01-threads-v1',binding,reviewedBy:'Kevin',sourceRecheckedAt:new Date().toISOString()};
 const out=prepareVariant(input);assert.equal(out.accountKey,'asap_gta6:threads');assert.equal(out.envelope.id,'G01-threads-v1');assert.equal(out.content.type,'text');assert.equal(out.content.text,wave.items[0].variants[0].text);
 assert.throws(()=>prepareVariant({...input,binding:null}),/VERIFIED_BINDING_REQUIRED/);
 assert.throws(()=>prepareVariant({...input,binding:{...binding,brandId:'asap_katy'}}),/VERIFIED_BINDING_REQUIRED/);
 assert.throws(()=>prepareVariant({...input,binding:{...binding,verifiedAt:'2020-01-01'}}),/RECHECK_REQUIRED/);
 assert.throws(()=>prepareVariant({...input,binding:{...binding,verifiedAt:'2099-01-01'}}),/RECHECK_REQUIRED/);
 assert.throws(()=>prepareVariant({...input,sourceRecheckedAt:'2020-01-01'}),/EDITORIAL_PREFLIGHT_REQUIRED/);
});
test('Instagram first-wave bridge requires exact asset hash, lawful use and public staging',()=>{
 const input={wave,variantId:'G01-instagram-v1',binding:{...binding,platform:'instagram',accountKey:'asap_gta6:instagram'},reviewedBy:'Kevin',sourceRecheckedAt:new Date().toISOString()};
 assert.throws(()=>prepareVariant(input),/STAGING_AND_RIGHTS/);
 const out=prepareVariant({...input,media:{assetSha256:wave.items[0].asset.sha256,rights:'owned-or-authorized',publicUrl:'https://example.com/fixture.jpg'}});assert.equal(out.content.type,'image');
});
