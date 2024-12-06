The goal here is to spot improvements to sqlite drivers, or drizzle itself, such that robustTransactions is no longer needed.

The tests are designed to *succeed* while the inconsistencies/transaction-fails are *still happening*. 

So if they start failing, the drivers (or Drizzle) may have been improved to fix some of the issues that make robustTransaction necessary. 