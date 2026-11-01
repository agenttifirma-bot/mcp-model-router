import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Db } from "../src/lib/db.js";
import { budgetFor, createTokenBudget, estimateInputTokens } from "../src/lib/budget.js";
import { DAILY_TOKEN_BUDGET, LimitExceededError, budgetDay } from "../src/lib/limits.js";

describe("estimateInputTokens", () => {
  it("tyhjä viestilista on 0", () => {
    expect(estimateInputTokens([])).toBe(0);
  });

  it("tyhjä sisältö maksaa vain viestikohtaisen 4 tokenin lisän", () => {
    expect(estimateInputTokens([{ content: "" }])).toBe(4);
  });

  it("pyöristää merkkimäärän / 3 ylöspäin ja lisää 4 per viesti", () => {
    expect(estimateInputTokens([{ content: "abc" }])).toBe(1 + 4);
    expect(estimateInputTokens([{ content: "abcd" }])).toBe(2 + 4);
    expect(estimateInputTokens([{ content: "a".repeat(30) }])).toBe(10 + 4);
  });

  it("summaa viestit", () => {
    expect(estimateInputTokens([{ content: "abc" }, { content: "abcd" }, { content: "" }])).toBe(5 + 6 + 4);
  });

  it("laskee merkit (UTF-16-yksiköt), ei tavuja", () => {
    expect(estimateInputTokens([{ content: "äää" }])).toBe(1 + 4);
  });
});

describe("createTokenBudget", () => {
  let db: Db;
  const today = () => budgetDay(new Date());

  beforeEach(() => {
    db = new Db(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("reserve kirjaa varauksen kantaan", () => {
    createTokenBudget(db).reserve(500);
    expect(db.getReservedTokens(today())).toBe(500);
  });

  it("varaukset kertyvät", () => {
    const budget = createTokenBudget(db);
    budget.reserve(100);
    budget.reserve(250);
    expect(db.getReservedTokens(today())).toBe(350);
  });

  it("nollavaraus sallitaan", () => {
    expect(() => createTokenBudget(db).reserve(0)).not.toThrow();
    expect(db.getReservedTokens(today())).toBe(0);
  });

  it("epäkelvot varaukset (negatiivinen, NaN, Infinity) hylätään eikä kantaa muuteta", () => {
    const budget = createTokenBudget(db);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => budget.reserve(bad)).toThrow(LimitExceededError);
    }
    expect(db.getReservedTokens(today())).toBe(0);
  });

  describe("settle", () => {
    it("korjaa varauksen alaspäin toteutuneeseen käyttöön", () => {
      const r = createTokenBudget(db).reserve(1000);
      r.settle(42);
      expect(db.getReservedTokens(today())).toBe(42);
    });

    it("korjaa varauksen myös ylöspäin, jos käyttö ylitti arvion", () => {
      const r = createTokenBudget(db).reserve(100);
      r.settle(500);
      expect(db.getReservedTokens(today())).toBe(500);
    });

    it("pyöristää murtoluvun ylöspäin", () => {
      const r = createTokenBudget(db).reserve(1000);
      r.settle(41.2);
      expect(db.getReservedTokens(today())).toBe(42);
    });

    it("nollakäyttö vapauttaa koko varauksen", () => {
      const r = createTokenBudget(db).reserve(1000);
      r.settle(0);
      expect(db.getReservedTokens(today())).toBe(0);
    });

    it("korjaa vain oman varauksensa, ei muiden", () => {
      const budget = createTokenBudget(db);
      budget.reserve(300);
      const r = budget.reserve(1000);
      r.settle(100);
      expect(db.getReservedTokens(today())).toBe(400);
    });

    it("jos käyttöä ei tiedetä tai se on epäkelpo, varaus jää voimaan (fail closed)", () => {
      for (const bad of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
        const local = new Db(":memory:");
        try {
          const r = createTokenBudget(local).reserve(1000);
          r.settle(bad);
          expect(local.getReservedTokens(today())).toBe(1000);
        } finally {
          local.close();
        }
      }
    });

    it("vapautunut tila on heti käytettävissä seuraavalle varaukselle", () => {
      const budget = createTokenBudget(db);
      const r = budget.reserve(DAILY_TOKEN_BUDGET);
      expect(() => budget.reserve(1)).toThrow(LimitExceededError);
      r.settle(DAILY_TOKEN_BUDGET - 10);
      expect(() => budget.reserve(10)).not.toThrow();
      expect(() => budget.reserve(1)).toThrow(LimitExceededError);
    });
  });
});

describe("budgetFor", () => {
  it("annetulla kannalla varaus näkyy samassa kannassa", () => {
    const db = new Db(":memory:");
    try {
      budgetFor(db).reserve(123);
      expect(db.getReservedTokens(budgetDay(new Date()))).toBe(123);
    } finally {
      db.close();
    }
  });

  it("eri kannat ovat toisistaan riippumattomia", () => {
    const a = new Db(":memory:");
    const b = new Db(":memory:");
    try {
      budgetFor(a).reserve(DAILY_TOKEN_BUDGET);
      expect(() => budgetFor(b).reserve(1)).not.toThrow();
    } finally {
      a.close();
      b.close();
    }
  });

  it("ilman kantaa raja on silti voimassa ja jaettu prosessin sisällä", () => {
    // Viimeinen testi, joka käyttää prosessin muistikantaa: tila jää tähän tiedostoon (vitest eristää tiedostot).
    budgetFor().reserve(DAILY_TOKEN_BUDGET);
    expect(() => budgetFor().reserve(1)).toThrow(LimitExceededError);
  });
});
