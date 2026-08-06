export const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

function allDigitsEqual(value) {
  return /^(\d)\1+$/.test(value);
}

export function validCpf(value) {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11 || allDigitsEqual(cpf)) return false;
  const check = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const digit = (sum * 10) % 11;
    return (digit === 10 ? 0 : digit) === Number(cpf[length]);
  };
  return check(9) && check(10);
}

export function validCnpj(value) {
  const cnpj = digitsOnly(value);
  if (cnpj.length !== 14 || allDigitsEqual(cnpj)) return false;
  const calculate = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder = base.split("").reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(cnpj.slice(0, 12));
  const second = calculate(`${cnpj.slice(0, 12)}${first}`);
  return cnpj.endsWith(`${first}${second}`);
}

export function normalizeBillingProfile(input = {}) {
  const accountType = input.accountType === "company" ? "company" : "person";
  const text = (value, max) => String(value || "").trim().slice(0, max);
  return {
    accountType,
    legalName: text(input.legalName, 120),
    phone: text(input.phone, 24), postalCode: digitsOnly(input.postalCode).slice(0, 8),
    address: text(input.address, 140), addressNumber: text(input.addressNumber, 20),
    complement: text(input.complement, 80), district: text(input.district, 80),
    city: text(input.city, 80), state: text(input.state, 2).toUpperCase(),
  };
}
