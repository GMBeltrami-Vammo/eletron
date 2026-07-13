import { describe, expect, it } from "vitest";

import { visiblePaymentFields } from "./payment-fields";

describe("visiblePaymentFields", () => {
  it("transferência needs banco/agência/conta", () => {
    expect(visiblePaymentFields("transferencia")).toEqual(["banco_agencia_conta"]);
  });

  it("pix needs the chave", () => {
    expect(visiblePaymentFields("pix")).toEqual(["chave_pix"]);
  });

  it("boleto (email or celular) needs the linha digitável", () => {
    expect(visiblePaymentFields("boleto_email")).toEqual(["codigo_boleto"]);
    expect(visiblePaymentFields("boleto_celular")).toEqual(["codigo_boleto"]);
  });

  it("débito automático / outro / unset need no manual instrument", () => {
    expect(visiblePaymentFields("debito_automatico")).toEqual([]);
    expect(visiblePaymentFields("outro")).toEqual([]);
    expect(visiblePaymentFields("")).toEqual([]);
  });
});
