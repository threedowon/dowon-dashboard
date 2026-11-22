export const MAX_PACK_SIZE = 10000;

// Absence means a normal product (including a set purchased as one unit).
export function validPackSize(value) {
 return value === undefined || Number.isInteger(value) && value >= 2 && value <= MAX_PACK_SIZE;
}

export function calculateOrder(quantity, packSize) {
 const isBundle = packSize !== undefined && validPackSize(packSize);
 const unitsPerPack = isBundle ? packSize : 1;
 const orderQuantity = Math.ceil(quantity / unitsPerPack);
 const receivedQuantity = orderQuantity * unitsPerPack;
 return {quantity, isBundle, packSize: unitsPerPack, orderQuantity, receivedQuantity, extraQuantity: receivedQuantity - quantity};
}

export function formatOrder(order) {
 return order.isBundle
  ? `${order.orderQuantity}묶음\n${order.packSize}개입 · 총 ${order.receivedQuantity}개\n여분 ${order.extraQuantity}개`
  : String(order.orderQuantity);
}
