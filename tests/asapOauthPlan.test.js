const test=require('node:test');const assert=require('node:assert/strict');const {prepareThreadsAuthorization,verifyReturnedState}=require('../app/asap/oauthPlan');
test('OAuth preparation needs confirmed app-specific ID, exact registered redirect and CSRF state',()=>{
 const input={brand:'asap_gta6',confirmedThreadsAppId:'123',confirmedRedirectUri:'https://asap.example/auth/threads',registeredRedirectUris:['https://asap.example/auth/threads'],state:'s'.repeat(48)};
 const plan=prepareThreadsAuthorization(input);assert.equal(new URL(plan.authorizationUrl).origin,'https://threads.net');assert.deepEqual(plan.scopes,['threads_basic','threads_content_publish','threads_manage_insights']);assert.equal(plan.mutatesExternalState,false);assert.equal(plan.ownerConsentRequired,true);
 assert.throws(()=>prepareThreadsAuthorization({...input,confirmedThreadsAppId:null}),/APP_ID_REQUIRED/);assert.throws(()=>prepareThreadsAuthorization({...input,confirmedRedirectUri:input.confirmedRedirectUri+'/'}),/EXACT_REGISTERED/);assert.throws(()=>prepareThreadsAuthorization({...input,state:'short'}),/CSRF/);
 assert.equal(verifyReturnedState(input.state,input.state),true);assert.equal(verifyReturnedState(input.state,'bad'),false);
});
