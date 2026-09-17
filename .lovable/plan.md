# Correct payroll percentages

## Changes
- Change lateness to completed five-minute blocks: 0–4 minutes = 0%, 5–9 = 5%, 10–14 = 10%, capped at 100%.
- Apply the same completed-block rule to early sign-out, while keeping missed sign-out at 20% and absence at 100% of one day.
- Recalculate saved attendance percentages from recorded sign-in and sign-out times so old incorrect values are corrected.
- Make every weekly and monthly view use each staff member’s own monthly salary divided by that month’s actual Monday–Friday working days, excluding holidays.
- Verify current records: the same percentage produces a lower naira deduction for a lower salary.

## Technical details
- Update the attendance calculation in the database and repair historical `deduction_amount` values without changing attendance times.
- Replace the incorrect weekly `salary ÷ 5` calculation and selected-range divisor in the staff history page with month-based daily pay.
- Check the app build and compare representative ₦15,000 and ₦20,000 staff calculations.
