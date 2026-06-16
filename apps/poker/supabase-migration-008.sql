-- =============================================================================
-- GokkeHub Poker — migration 008: player-initiated withdrawals
-- Run after 001–007. ADDITIVE — safe anytime.
--
-- A player requests to take money back OUT of their balance (the house pays them
-- via MobilePay/etc and confirms it, mirroring a top-up). Creates a PENDING
-- withdrawal; balance only drops once an admin confirms. If the player spends the
-- funds before confirmation, the confirm fails on the balance>=0 CHECK (safe).
-- =============================================================================

create or replace function poker_request_withdrawal(p_amount integer)
returns poker_transactions language plpgsql security definer set search_path = public as $$
declare tx poker_transactions; g uuid; bal integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  g := poker_my_group();
  if g is null or not poker_is_member(g) then raise exception 'join or select a group first'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  bal := poker_balance_of(auth.uid(), g);
  if bal < p_amount then raise exception 'you only have % to withdraw', bal; end if;

  insert into poker_transactions (user_id, group_id, amount, type, status, note)
  values (auth.uid(), g, p_amount, 'withdrawal', 'pending', 'Withdrawal request')
  returning * into tx;
  return tx;
end; $$;

grant execute on function poker_request_withdrawal(integer) to authenticated;
