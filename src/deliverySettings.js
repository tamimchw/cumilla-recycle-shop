export const deliveryZones = [
  { key: "inside", label: "Inside Cumilla" },
  { key: "outside", label: "Outside Cumilla" },
];

const zoneDistrictNames = {
  inside: ["inside cumilla", "inside comilla"],
  outside: ["outside cumilla", "outside comilla"],
};

const normalizeDistrict = (district) =>
  String(district || "").trim().toLowerCase().replace(/\s+/g, " ");

export function getDeliveryZoneKey(district) {
  const normalizedDistrict = normalizeDistrict(district);
  return ["cumilla", "comilla"].includes(normalizedDistrict)
    ? "inside"
    : "outside";
}

export function findDeliverySetting(settings, zoneKey) {
  const validNames = zoneDistrictNames[zoneKey] || [];
  return settings.find((setting) =>
    validNames.includes(normalizeDistrict(setting.district))
  );
}

export function getValidDeliveryCharge(setting) {
  if (
    !setting ||
    setting.delivery_charge == null ||
    String(setting.delivery_charge).trim() === ""
  ) {
    return null;
  }

  const charge = Number(setting.delivery_charge);
  return Number.isFinite(charge) && charge >= 0 ? charge : null;
}
