/*
  pgTyped example — SQL is the source of truth; `npm run pgtyped` generates
  `balances.queries.ts` with fully-typed params & result rows (no ORM).
  This file is not imported until you run codegen against a live DB.
*/

/* @name ListAccountBalances */
SELECT account_id, account_kind, currency, balance::text AS balance
FROM   v_account_balance
ORDER  BY account_id;

/* @name GetAccountBalance */
SELECT balance::text AS balance
FROM   v_account_balance
WHERE  account_id = :accountId!;
