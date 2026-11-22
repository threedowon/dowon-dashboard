import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateOrder,formatOrder,validPackSize,MAX_PACK_SIZE} from './hardware/lib/order-quantity.js';

test('normal products and sets use the requested quantity without conversion',()=>{
 const order=calculateOrder(5);
 assert.equal(order.orderQuantity,5);assert.equal(order.receivedQuantity,5);assert.equal(order.extraQuantity,0);assert.equal(order.isBundle,false);assert.equal(formatOrder(order),'5');
});
test('bundles round up once, including exact multiples and zero',()=>{
 for(const [quantity,packSize,expected,received,extra] of [[5,3,2,6,1],[6,3,2,6,0],[1,3,1,3,2],[0,3,0,0,0],[299700,10000,30,300000,300]]){
  const order=calculateOrder(quantity,packSize);
  assert.equal(order.orderQuantity,expected);assert.equal(order.receivedQuantity,received);assert.equal(order.extraQuantity,extra);assert.equal(order.isBundle,true);
 }
 assert.equal(formatOrder(calculateOrder(5,3)),'2묶음\n3개입 · 총 6개\n여분 1개');
});
test('bundle sizes must be whole numbers in range; old records need no new field',()=>{
 for(const value of [undefined,2,3,MAX_PACK_SIZE])assert.equal(validPackSize(value),true);
 for(const value of [null,0,1,-2,2.5,'3',NaN,Infinity,MAX_PACK_SIZE+1,true]){
  assert.equal(validPackSize(value),false);assert.equal(calculateOrder(5,value).isBundle,false);
 }
});
