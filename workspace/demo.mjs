/* Explicit synthetic metadata. This module is never loaded into the user key. */
import {createWorkspace,prepareRecord,addRecords,attestRecord,latestRecords} from './core.mjs';

export async function createDemo() {
  let state=createWorkspace('Gross additions — synthetic example','demo');
  async function add(kind,id,name,spec,extra={}) {
    const values={id,name,owner:'Synthetic example owner',aliases:[],classification:'internal',
      description:'Synthetic context for learning the workspace. No external source is connected.',
      narrative:'This is invented example metadata. Review is simulated. Do not use it as a business definition or source permission.',
      valid_from:'2026-01-01T00:00:00Z',valid_until:null,spec,...extra};
    const prepared=await prepareRecord(state,kind,values);
    state=await addRecords(state,[prepared.record],{submissions:[prepared.submission]});
  }
  await add('term','TERM_CUSTOMER','Customer',{definition:'In this example, an account holder who can place an order.',related_terms:[]});
  await add('document','DOC_ORDER_GUIDE','Order guide',{media_type:'text/plain',summary:'A synthetic guide that distinguishes completed and cancelled orders.',related:['TERM_CUSTOMER']});
  await add('event','EVENT_ORDER_COMPLETED','Order completed',{trigger:'An example order enters the completed state.',time_field:'completed_at',entities:['TERM_CUSTOMER']});
  await add('policy','POLICY_COMPLETED_ONLY','Count completed orders',{rule:'Count completed orders. Exclude cancelled orders.',applies_to:['EVENT_ORDER_COMPLETED','DOC_ORDER_GUIDE']});
  await add('dimension','CHANNEL','Channel',{value_type:'text'});
  await add('dimension','PRODUCT','Product',{value_type:'text'});
  await add('dimension','PERIOD','Reporting period',{value_type:'period'});
  await add('member','CHANNEL_ONLINE','Online',{dimension:'CHANNEL',value:'online',parents:[]});
  await add('member','PRODUCT_POSTPAID','Postpaid',{dimension:'PRODUCT',value:'postpaid',parents:[]});
  await add('member','PERIOD_2026_09','September 2026',{dimension:'PERIOD',value:'2026-09',parents:[]});
  await add('source','SOURCE_ORDERS','Example orders',{binding:'example.orders',grain:['order_id'],freshness_seconds:86400,checked_at:new Date().toISOString(),dimensions:{CHANNEL:'channel',PRODUCT:'product',PERIOD:'period'}});
  const byId=new Map(latestRecords(state).map(r=>[r.id,r]));
  await add('guidance','GUIDE_GROSS_ADDS','Gross additions guidance',{qualifiers:['Completed synthetic orders only.'],caveats:['This is not a production telecom definition or a causal explanation.']},
    {dependencies:['POLICY_COMPLETED_ONLY','DOC_ORDER_GUIDE'].map(id=>({id,version:byId.get(id).version}))});
  await add('measure','M_GROSS_ADDS','Gross additions',{source:'SOURCE_ORDERS',aggregation:'count',expression:'count_completed_orders',required_dimensions:['PERIOD'],optional_dimensions:['CHANNEL','PRODUCT'],guidance:['GUIDE_GROSS_ADDS']},
    {aliases:['gross adds','new completed orders']});
  for(const record of state.records)state=await attestRecord(state,record.id,record.version,'Example reviewer (simulated)');
  return state;
}
