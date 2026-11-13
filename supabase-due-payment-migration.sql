-- CRS due, partial-payment, delivery and payment-history migration.
--
-- Review this file before running it in Supabase SQL Editor.
-- It is intentionally additive and does not replace either existing order
-- RPC or the existing create_direct_sale RPC.
--
-- Historical sales are marked Paid once, as explicitly required. Historical
-- orders retain NULL payment fields because their actual payment state is not
-- available. No historical payment rows are fabricated.
--
-- The deployed order-notification Edge Function is not present in this
-- workspace. This migration neither changes nor verifies that function.

BEGIN;

-- Fail closed if this migration is pointed at a schema other than the one
-- reported for this change.
DO $preflight$
DECLARE
  v_direct_sale_is_definer boolean;
  v_direct_sale_owner oid;
  v_sale_payments_owner oid;
  v_owner_bypasses_rls boolean;
  v_payments_force_rls boolean;
  v_executor_bypasses_rls boolean;
  v_executor_owns_tables boolean;
  v_executor_force_rls boolean;
  v_existing_sale_fk oid;
  v_exact_sale_fk_count integer;
  v_orders_policy_count bigint;
  v_orders_policy_cmd text;
  v_orders_policy_permissive text;
  v_orders_policy_roles text;
  v_orders_policy_using text;
  v_orders_policy_with_check text;
  v_orders_policy_using_normalized text;
  v_orders_policy_check_normalized text;
BEGIN
  IF to_regclass('public.sales') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.sale_payments') IS NULL
     OR to_regclass('public.admin_users') IS NULL THEN
    RAISE EXCEPTION
      'Required CRS tables are missing; migration stopped without changes.';
  END IF;

  IF to_regprocedure(
    'public.create_direct_sale(text,text,text,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Expected public.create_direct_sale(text,text,text,jsonb) was not found.';
  END IF;

  SELECT p.prosecdef, p.proowner, c.relowner, c.relforcerowsecurity
    INTO v_direct_sale_is_definer,
         v_direct_sale_owner,
         v_sale_payments_owner,
         v_payments_force_rls
  FROM pg_proc p
  CROSS JOIN pg_class c
  WHERE p.oid = to_regprocedure(
          'public.create_direct_sale(text,text,text,jsonb)'
        )
    AND c.oid = 'public.sale_payments'::regclass;

  SELECT r.rolsuper OR r.rolbypassrls
    INTO v_owner_bypasses_rls
  FROM pg_roles r
  WHERE r.oid = v_direct_sale_owner;

  IF NOT v_direct_sale_is_definer
     OR (
       v_direct_sale_owner <> v_sale_payments_owner
       AND NOT COALESCE(v_owner_bypasses_rls, false)
     )
     OR (
       v_payments_force_rls
       AND NOT COALESCE(v_owner_bypasses_rls, false)
     ) THEN
    RAISE EXCEPTION
      'The existing direct-sale RPC does not have a verified RLS-safe owner. Review its security mode/owner before enabling sale_payments RLS.';
  END IF;

  SELECT
    r.rolsuper OR r.rolbypassrls,
    bool_and(c.relowner = r.oid),
    bool_or(c.relforcerowsecurity)
    INTO v_executor_bypasses_rls,
         v_executor_owns_tables,
         v_executor_force_rls
  FROM pg_roles r
  CROSS JOIN pg_class c
  WHERE r.rolname = current_user
    AND c.oid IN (
      'public.sales'::regclass,
      'public.orders'::regclass,
      'public.sale_payments'::regclass
    )
  GROUP BY r.rolsuper, r.rolbypassrls;

  IF (
       NOT COALESCE(v_executor_bypasses_rls, false)
       AND NOT COALESCE(v_executor_owns_tables, false)
     )
     OR (
       COALESCE(v_executor_force_rls, false)
       AND NOT COALESCE(v_executor_bypasses_rls, false)
     ) THEN
    RAISE EXCEPTION
      'The migration role cannot safely own the new SECURITY DEFINER RPCs under the current RLS settings.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('sales', 'orders')
      AND column_name IN (
        'total', 'subtotal', 'paid_amount', 'due_amount',
        'delivery_charge', 'payment_status'
      )
      AND data_type NOT IN ('numeric', 'text')
  ) THEN
    RAISE EXCEPTION
      'A payment or total column has an unexpected type; migration stopped.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('sales', 'subtotal', 12, 2),
        ('sales', 'total', 12, 2),
        ('sales', 'paid_amount', 12, 2),
        ('sales', 'due_amount', 12, 2),
        ('orders', 'subtotal', 10, 2),
        ('orders', 'total', 10, 2),
        ('orders', 'delivery_charge', 10, 2),
        ('sale_payments', 'amount', 12, 2)
    ) AS expected(table_name, column_name, precision_value, scale_value)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'public'
     AND actual.table_name = expected.table_name
     AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
       OR actual.data_type <> 'numeric'
       OR actual.numeric_precision <> expected.precision_value
       OR actual.numeric_scale <> expected.scale_value
  ) THEN
    RAISE EXCEPTION
      'A money column is missing or has unexpected precision/scale; review the live schema before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'sales' AND column_name = 'delivery_charge')
        OR (table_name = 'orders' AND column_name IN ('paid_amount', 'due_amount'))
      )
      AND (
        data_type <> 'numeric'
        OR numeric_precision <> 12
        OR numeric_scale <> 2
      )
  ) THEN
    RAISE EXCEPTION
      'An existing delivery/payment column has unexpected precision; migration will not silently retain a narrower or incompatible type.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales'
      AND column_name = 'created_at'
      AND data_type IN ('timestamp with time zone', 'timestamp without time zone')
  ) THEN
    RAISE EXCEPTION
      'sales.created_at is missing or is not a timestamp; the wrapper cannot prove it is updating a newly-created sale.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid IN (
      'public.sales'::regclass,
      'public.orders'::regclass
    )
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%payment_status%'
  ) THEN
    RAISE EXCEPTION
      'An existing payment_status CHECK constraint requires manual review before adding Paid/Partial/Due states.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid = 'public.orders'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'RLS must already be enabled on public.orders before changing its update policy.';
  END IF;

  SELECT
    count(*),
    min(p.cmd),
    min(p.permissive),
    min(p.roles::text),
    min(p.qual),
    min(p.with_check)
    INTO v_orders_policy_count,
         v_orders_policy_cmd,
         v_orders_policy_permissive,
         v_orders_policy_roles,
         v_orders_policy_using,
         v_orders_policy_with_check
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'orders'
    AND p.policyname = 'Admin can update orders';

  v_orders_policy_using_normalized := replace(
    regexp_replace(
      COALESCE(v_orders_policy_using, ''),
      '[[:space:]]',
      '',
      'g'
    ),
    '::text',
    ''
  );
  v_orders_policy_check_normalized := replace(
    regexp_replace(
      COALESCE(v_orders_policy_with_check, ''),
      '[[:space:]]',
      '',
      'g'
    ),
    '::text',
    ''
  );

  IF v_orders_policy_count <> 1
     OR v_orders_policy_cmd IS DISTINCT FROM 'UPDATE'
     OR v_orders_policy_permissive IS DISTINCT FROM 'PERMISSIVE'
     OR v_orders_policy_roles IS DISTINCT FROM '{authenticated}'
     OR v_orders_policy_using_normalized
       IS DISTINCT FROM '((auth.jwt()->>''email'')=''nasimanoha9@gmail.com'')'
     OR v_orders_policy_check_normalized
       IS DISTINCT FROM '((auth.jwt()->>''email'')=''nasimanoha9@gmail.com'')' THEN
    RAISE EXCEPTION
      'Orders policy "Admin can update orders" differs from the verified authenticated-only email policy; review its exact definition before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orders'
      AND cmd IN ('UPDATE', 'ALL')
      AND policyname <> 'Admin can update orders'
  ) THEN
    RAISE EXCEPTION
      'Additional Orders update policies exist; review policy interaction before replacing the admin allowlist.';
  END IF;

  -- The table-level UPDATE grants to PUBLIC, anon and authenticated are
  -- revoked below. Column-level ACLs are separate and survive that revoke.
  -- Fail closed if a frontend role can still update payment or pricing data
  -- directly, including through a role it inherits.
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid = 'public.orders'::regclass
      AND NOT a.attisdropped
      AND a.attname IN (
        'total',
        'paid_amount',
        'due_amount',
        'payment_status',
        'delivery_charge',
        'free_delivery'
      )
      AND acl.privilege_type = 'UPDATE'
      AND CASE
        WHEN acl.grantee = 0 THEN true
        ELSE
          pg_has_role('anon', acl.grantee, 'USAGE')
          OR pg_has_role('authenticated', acl.grantee, 'USAGE')
      END
  ) THEN
    RAISE EXCEPTION
      'A column-level UPDATE grant on Orders payment/pricing data is available to anon or authenticated; revoke or review it before migration.';
  END IF;

  -- A table-level UPDATE grant to a role inherited by anon/authenticated
  -- would also survive revoking grants only from PUBLIC, anon and
  -- authenticated themselves.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) acl
    WHERE c.oid = 'public.orders'::regclass
      AND acl.privilege_type = 'UPDATE'
      AND CASE
        WHEN acl.grantee = 0 THEN false
        WHEN acl.grantee = to_regrole('anon')::oid THEN false
        WHEN acl.grantee = to_regrole('authenticated')::oid THEN false
        ELSE
          pg_has_role('anon', acl.grantee, 'USAGE')
          OR pg_has_role('authenticated', acl.grantee, 'USAGE')
      END
  ) THEN
    RAISE EXCEPTION
      'An inherited table-level UPDATE grant on Orders would survive the migration revokes; review role membership and grants before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sale_payments'
  ) THEN
    RAISE EXCEPTION
      'Existing sale_payments RLS policies require manual review; migration will not replace or combine them blindly.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid IN (
      'public.sales'::regclass,
      'public.orders'::regclass,
      'public.sale_payments'::regclass
    )
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Existing user triggers on sales, orders, or sale_payments require manual review before adding payment triggers.';
  END IF;

  -- Preserve the live sale_id foreign key exactly as found; only the new
  -- order_id foreign key is created by this migration.
  SELECT count(*)
    INTO v_exact_sale_fk_count
  FROM pg_constraint c
  JOIN pg_attribute source_col
    ON source_col.attrelid = c.conrelid
   AND source_col.attname = 'sale_id'
   AND NOT source_col.attisdropped
  JOIN pg_attribute target_col
    ON target_col.attrelid = c.confrelid
   AND target_col.attname = 'id'
   AND NOT target_col.attisdropped
  WHERE c.conname = 'sale_payments_sale_id_fkey'
    AND c.conrelid = 'public.sale_payments'::regclass
    AND c.confrelid = 'public.sales'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[source_col.attnum]::smallint[]
    AND c.confkey = ARRAY[target_col.attnum]::smallint[]
    AND c.confdeltype = 'r'
    AND c.confupdtype = 'a'
    AND NOT c.condeferrable
    AND NOT c.condeferred;

  IF v_exact_sale_fk_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one sale_payments_sale_id_fkey from sale_payments.sale_id to sales.id ON DELETE RESTRICT; migration stopped.';
  END IF;

  SELECT c.oid
    INTO v_existing_sale_fk
  FROM pg_constraint c
  JOIN pg_attribute source_col
    ON source_col.attrelid = c.conrelid
   AND source_col.attname = 'sale_id'
   AND NOT source_col.attisdropped
  JOIN pg_attribute target_col
    ON target_col.attrelid = c.confrelid
   AND target_col.attname = 'id'
   AND NOT target_col.attisdropped
  WHERE c.conname = 'sale_payments_sale_id_fkey'
    AND c.conrelid = 'public.sale_payments'::regclass
    AND c.confrelid = 'public.sales'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[source_col.attnum]::smallint[]
    AND c.confkey = ARRAY[target_col.attnum]::smallint[]
    AND c.confdeltype = 'r'
    AND c.confupdtype = 'a'
    AND NOT c.condeferrable
    AND NOT c.condeferred;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND (
        c.conrelid = 'public.sale_payments'::regclass
        OR c.confrelid = 'public.sale_payments'::regclass
      )
      AND c.oid <> v_existing_sale_fk
  ) THEN
    RAISE EXCEPTION
      'Unexpected foreign key involving sale_payments found; review it before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid IN (
      'public.sales'::regclass,
      'public.orders'::regclass,
      'public.sale_payments'::regclass
    )
      AND c.conname IN (
        'crs_sale_payments_order_fk',
        'crs_sale_payments_exactly_one_parent',
        'crs_sale_payments_positive_amount',
        'crs_sales_payment_state_check',
        'crs_orders_payment_state_check'
      )
  ) THEN
    RAISE EXCEPTION
      'A constraint name reserved by this migration already exists; inspect it rather than replacing it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      to_regclass('public.crs_sale_payments_sale_date_idx'),
      to_regclass('public.crs_sale_payments_order_date_idx'),
      to_regclass('public.crs_sale_payments_received_by_idx')
    )
  ) THEN
    RAISE EXCEPTION
      'An index name reserved by this migration already exists; inspect it rather than skipping or replacing it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.sale_payments'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND (
        pg_get_indexdef(i.indexrelid) ILIKE '%(sale_id)%'
        OR pg_get_indexdef(i.indexrelid) ILIKE '%(order_id)%'
      )
  ) THEN
    RAISE EXCEPTION
      'A unique sale_payments index may prevent multiple payment transactions; inspect it before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_payments sp
    LEFT JOIN public.sales s ON s.id = sp.sale_id
    WHERE sp.sale_id IS NOT NULL
      AND s.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'sale_payments contains orphan sale_id values; resolve them before adding the foreign key.';
  END IF;
END;
$preflight$;

-- Sales already has paid_amount, due_amount and payment_status. Do not add
-- duplicate columns. delivery_charge stores the original entered charge;
-- actual charge and discount are derived from free_delivery.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS delivery_charge numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_delivery boolean NOT NULL DEFAULT false;

-- delivery_charge on orders remains the original charge. The free_delivery
-- flag determines the actual charge; total remains the final payable amount.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS free_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS due_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_status text;

-- Reuse sale_payments for both sale and order transactions.
ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS order_id bigint,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ALTER COLUMN sale_id DROP NOT NULL;

-- Validate the existing payment table before adding relational constraints.
DO $payment_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sale_payments
    WHERE amount <= 0
       OR amount::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION
      'sale_payments has non-positive or non-finite amounts; review existing rows before adding the payment constraint.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sale_payments sp
    LEFT JOIN public.orders o ON o.id = sp.order_id
    WHERE sp.order_id IS NOT NULL
      AND o.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'sale_payments contains orphan order_id values; resolve them before adding the foreign key.';
  END IF;
END;
$payment_preflight$;

DO $payment_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sale_payments'::regclass
      AND conname = 'crs_sale_payments_order_fk'
  ) THEN
    ALTER TABLE public.sale_payments
      ADD CONSTRAINT crs_sale_payments_order_fk
      FOREIGN KEY (order_id) REFERENCES public.orders(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sale_payments'::regclass
      AND conname = 'crs_sale_payments_exactly_one_parent'
  ) THEN
    ALTER TABLE public.sale_payments
      ADD CONSTRAINT crs_sale_payments_exactly_one_parent
      CHECK ((sale_id IS NOT NULL) <> (order_id IS NOT NULL))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sale_payments'::regclass
      AND conname = 'crs_sale_payments_positive_amount'
  ) THEN
    ALTER TABLE public.sale_payments
      ADD CONSTRAINT crs_sale_payments_positive_amount
      CHECK (
        amount > 0
        AND amount <> 'NaN'::numeric
        AND amount < 'Infinity'::numeric
      )
      NOT VALID;
  END IF;
END;
$payment_constraints$;

ALTER TABLE public.sale_payments
  VALIDATE CONSTRAINT crs_sale_payments_order_fk;
ALTER TABLE public.sale_payments
  VALIDATE CONSTRAINT crs_sale_payments_exactly_one_parent;
ALTER TABLE public.sale_payments
  VALIDATE CONSTRAINT crs_sale_payments_positive_amount;

CREATE INDEX crs_sale_payments_sale_date_idx
  ON public.sale_payments (sale_id, payment_date DESC)
  WHERE sale_id IS NOT NULL;
CREATE INDEX crs_sale_payments_order_date_idx
  ON public.sale_payments (order_id, payment_date DESC)
  WHERE order_id IS NOT NULL;
CREATE INDEX crs_sale_payments_received_by_idx
  ON public.sale_payments (received_by)
  WHERE received_by IS NOT NULL;

-- A private marker makes the historical-sales backfill one-time and safe to
-- rerun. No historical sale_payments rows are inserted.
CREATE TABLE public.crs_due_payment_migration_state (
  migration_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crs_due_payment_migration_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crs_due_payment_migration_state
  FROM PUBLIC, anon, authenticated;

DO $historical_sales$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.crs_due_payment_migration_state
    WHERE migration_key = 'due-payment-v1-sales-backfill'
  ) THEN
    UPDATE public.sales
    SET paid_amount = total,
        due_amount = 0,
        payment_status = 'Paid';

    INSERT INTO public.crs_due_payment_migration_state (migration_key)
    VALUES ('due-payment-v1-sales-backfill');
  END IF;
END;
$historical_sales$;

ALTER TABLE public.sales
  ALTER COLUMN payment_status SET DEFAULT 'Paid';

DO $sales_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'crs_sales_payment_state_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT crs_sales_payment_state_check
      CHECK (
        paid_amount >= 0
        AND due_amount >= 0
        AND paid_amount <= total
        AND paid_amount + due_amount = total
        AND (
          (payment_status = 'Paid' AND due_amount = 0)
          OR (
            payment_status = 'Partial'
            AND paid_amount > 0
            AND due_amount > 0
          )
          OR (
            payment_status = 'Due'
            AND paid_amount = 0
            AND due_amount = total
          )
        )
      )
      NOT VALID;
  END IF;
END;
$sales_checks$;
ALTER TABLE public.sales
  VALIDATE CONSTRAINT crs_sales_payment_state_check;

DO $order_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'crs_orders_payment_state_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT crs_orders_payment_state_check
      CHECK (
        (
          paid_amount IS NULL
          AND due_amount IS NULL
          AND payment_status IS NULL
        )
        OR (
          paid_amount IS NOT NULL
          AND due_amount IS NOT NULL
          AND payment_status IS NOT NULL
          AND paid_amount >= 0
          AND due_amount >= 0
          AND paid_amount <= total
          AND paid_amount + due_amount = total
          AND (
            (payment_status = 'Paid' AND due_amount = 0)
            OR (
              payment_status = 'Partial'
              AND paid_amount > 0
              AND due_amount > 0
            )
            OR (
              payment_status = 'Due'
              AND paid_amount = 0
              AND due_amount = total
            )
          )
        )
      )
      NOT VALID;
  END IF;
END;
$order_checks$;
ALTER TABLE public.orders
  VALIDATE CONSTRAINT crs_orders_payment_state_check;

-- Keep legacy direct-sale creation behavior fully paid unless the new
-- versioned wrapper subsequently applies the explicitly supplied payment.
CREATE FUNCTION public.crs_sync_sale_payment_state_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.total IS NULL OR NEW.total < 0 THEN
    RAISE EXCEPTION 'Sale total must be zero or more.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.paid_amount := NEW.total;
  END IF;

  IF NEW.paid_amount IS NULL
     OR NEW.paid_amount < 0
     OR NEW.paid_amount > NEW.total THEN
    RAISE EXCEPTION 'Paid amount must be between zero and the sale total.';
  END IF;

  NEW.due_amount := NEW.total - NEW.paid_amount;
  NEW.payment_status := CASE
    WHEN NEW.due_amount = 0 THEN 'Paid'
    WHEN NEW.paid_amount = 0 THEN 'Due'
    ELSE 'Partial'
  END;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER crs_sales_payment_state_v1
BEFORE INSERT OR UPDATE OF total, paid_amount
ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.crs_sync_sale_payment_state_v1();

-- New website orders receive an initial Due state. Historical orders remain
-- untouched (all three payment columns stay NULL until reliably reconciled).
CREATE FUNCTION public.crs_initialize_order_payment_state_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.paid_amount IS NULL
     AND OLD.due_amount IS NULL
     AND OLD.payment_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.total IS NULL OR NEW.total < 0 THEN
    RAISE EXCEPTION 'Order total must be zero or more.';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.paid_amount IS NULL THEN
    NEW.paid_amount := 0;
  END IF;

  IF NEW.paid_amount IS NULL
     OR NEW.paid_amount < 0
     OR NEW.paid_amount > NEW.total THEN
    RAISE EXCEPTION 'Order paid amount must be between zero and its total.';
  END IF;

  NEW.due_amount := NEW.total - NEW.paid_amount;
  NEW.payment_status := CASE
    WHEN NEW.due_amount = 0 THEN 'Paid'
    WHEN NEW.paid_amount = 0 THEN 'Due'
    ELSE 'Partial'
  END;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER crs_orders_payment_state_v1
BEFORE INSERT OR UPDATE OF total, paid_amount
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.crs_initialize_order_payment_state_v1();

-- Direct sale wrapper: invokes the existing RPC exactly once (so its invoice
-- numbering and stock deduction remain authoritative), then applies delivery
-- and initial-payment fields in the same PostgreSQL transaction.
-- The existing RPC body is not checked into this workspace. Before execution,
-- verify whether it writes sale_payments; this wrapper accepts zero or one
-- initial row, rejects multiple rows, and only touches a sale created in this
-- transaction. It never rewrites payment rows for an older sale.
CREATE FUNCTION public.crs_create_direct_sale_with_payment_v1(
  p_customer_name text,
  p_phone text,
  p_payment_method text,
  p_items jsonb,
  p_delivery_charge numeric DEFAULT 0,
  p_free_delivery boolean DEFAULT false,
  p_initial_paid_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_created jsonb;
  v_invoice_number text;
  v_sale public.sales%ROWTYPE;
  v_original_delivery numeric(12, 2);
  v_final_total numeric(12, 2);
  v_paid numeric(12, 2);
  v_payment_count bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_method IS NULL
     OR p_payment_method NOT IN ('Cash', 'bKash', 'Nagad', 'Bank') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;

  IF p_delivery_charge IS NULL
     OR p_delivery_charge < 0
     OR p_delivery_charge::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Delivery charge must be a finite non-negative amount.';
  END IF;

  v_original_delivery := round(p_delivery_charge, 2);

  -- The function's returned object is part of the existing frontend contract.
  SELECT to_jsonb(public.create_direct_sale(
    p_customer_name,
    p_phone,
    p_payment_method,
    p_items
  ))
  INTO v_created;

  IF jsonb_typeof(v_created) = 'array' THEN
    IF jsonb_array_length(v_created) <> 1 THEN
      RAISE EXCEPTION
        'Existing create_direct_sale returned an unexpected result shape.';
    END IF;
    v_created := v_created -> 0;
  END IF;

  v_invoice_number := v_created ->> 'invoice_number';
  IF jsonb_typeof(v_created) <> 'object' OR v_invoice_number IS NULL THEN
    RAISE EXCEPTION
      'Existing create_direct_sale must return an object containing invoice_number.';
  END IF;

  SELECT * INTO STRICT v_sale
  FROM public.sales
  WHERE invoice_number = v_invoice_number
  FOR UPDATE;

  IF v_sale.created_at IS NULL
     OR v_sale.created_at < transaction_timestamp() THEN
    RAISE EXCEPTION
      'Existing direct-sale RPC did not return a sale created in this transaction; no payment history was changed.';
  END IF;

  v_final_total := round(
    v_sale.subtotal
      + CASE WHEN COALESCE(p_free_delivery, false)
          THEN 0
          ELSE v_original_delivery
        END,
    2
  );
  IF p_initial_paid_amount IS NOT NULL
     AND (
       p_initial_paid_amount < 0
       OR p_initial_paid_amount::text IN ('NaN', 'Infinity', '-Infinity')
     ) THEN
    RAISE EXCEPTION 'Initial payment must be finite and zero or more.';
  END IF;
  v_paid := round(COALESCE(p_initial_paid_amount, v_final_total), 2);

  IF v_paid < 0
     OR v_paid > v_final_total
     OR v_paid::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Initial payment must not exceed the final payable amount.';
  END IF;

  UPDATE public.sales
  SET delivery_charge = v_original_delivery,
      free_delivery = COALESCE(p_free_delivery, false),
      total = v_final_total,
      paid_amount = v_paid
  WHERE id = v_sale.id
  RETURNING * INTO v_sale;

  -- The sale freshness check above ensures any linked row belongs to this new
  -- sale. Reuse its sole initial row, or create one if the old RPC did not.
  SELECT count(*) INTO v_payment_count
  FROM public.sale_payments
  WHERE sale_id = v_sale.id;

  IF v_payment_count > 1 THEN
    RAISE EXCEPTION
      'Existing direct-sale RPC created multiple initial payment rows; transaction rolled back for review.';
  ELSIF v_payment_count = 1 THEN
    IF v_paid = 0 THEN
      DELETE FROM public.sale_payments WHERE sale_id = v_sale.id;
    ELSE
      UPDATE public.sale_payments
      SET amount = v_paid,
          payment_method = p_payment_method
      WHERE sale_id = v_sale.id;
    END IF;
  ELSIF v_paid > 0 THEN
    INSERT INTO public.sale_payments (
      sale_id, amount, payment_method, payment_date, received_by
    )
    VALUES (
      v_sale.id, v_paid, p_payment_method, now(), auth.uid()
    );
  END IF;

  RETURN v_created || jsonb_build_object(
    'id', v_sale.id,
    'invoice_number', v_sale.invoice_number,
    'subtotal', v_sale.subtotal,
    'delivery_charge', v_sale.delivery_charge,
    'free_delivery', v_sale.free_delivery,
    'total', v_sale.total,
    'paid_amount', v_sale.paid_amount,
    'due_amount', v_sale.due_amount,
    'payment_status', v_sale.payment_status
  );
END;
$function$;

CREATE FUNCTION public.crs_receive_sale_payment_v1(
  p_sale_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_due numeric(12, 2);
  v_payment numeric(12, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL
     OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Payment amount must be finite and greater than zero.';
  END IF;
  v_payment := round(p_amount, 2);
  IF v_payment <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero at cent precision.';
  END IF;
  IF p_payment_method IS NULL
     OR p_payment_method NOT IN ('Cash', 'bKash', 'Nagad', 'Bank') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;

  SELECT * INTO STRICT v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  v_due := v_sale.total - v_sale.paid_amount;
  IF v_payment > v_due THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance.';
  END IF;

  UPDATE public.sales
  SET paid_amount = paid_amount + v_payment
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  INSERT INTO public.sale_payments (
    sale_id, amount, payment_method, payment_date, note, received_by
  )
  VALUES (
    v_sale.id,
    v_payment,
    p_payment_method,
    now(),
    NULLIF(btrim(p_note), ''),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'invoice_number', v_sale.invoice_number,
    'total', v_sale.total,
    'paid_amount', v_sale.paid_amount,
    'due_amount', v_sale.due_amount,
    'payment_status', v_sale.payment_status
  );
END;
$function$;

CREATE FUNCTION public.crs_receive_order_payment_v1(
  p_order_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_due numeric(12, 2);
  v_payment numeric(12, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL
     OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Payment amount must be finite and greater than zero.';
  END IF;
  v_payment := round(p_amount, 2);
  IF v_payment <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero at cent precision.';
  END IF;
  IF p_payment_method IS NULL
     OR p_payment_method NOT IN ('Cash', 'bKash', 'Nagad', 'Bank') THEN
    RAISE EXCEPTION 'Unsupported payment method.';
  END IF;

  SELECT * INTO STRICT v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.paid_amount IS NULL
     OR v_order.due_amount IS NULL
     OR v_order.payment_status IS NULL THEN
    RAISE EXCEPTION
      'This historical order needs verified payment reconciliation before collecting payment.';
  END IF;

  v_due := v_order.total - v_order.paid_amount;
  IF v_payment > v_due THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding balance.';
  END IF;

  UPDATE public.orders
  SET paid_amount = paid_amount + v_payment
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.sale_payments (
    order_id, amount, payment_method, payment_date, note, received_by
  )
  VALUES (
    v_order.id,
    v_payment,
    p_payment_method,
    now(),
    NULLIF(btrim(p_note), ''),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'total', v_order.total,
    'paid_amount', v_order.paid_amount,
    'due_amount', v_order.due_amount,
    'payment_status', v_order.payment_status
  );
END;
$function$;

CREATE FUNCTION public.crs_set_order_free_delivery_v1(
  p_order_id bigint,
  p_free_delivery boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_final_total numeric(10, 2);
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_free_delivery IS NULL THEN
    RAISE EXCEPTION 'Free delivery selection is required.';
  END IF;

  SELECT * INTO STRICT v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.paid_amount IS NULL
     OR v_order.due_amount IS NULL
     OR v_order.payment_status IS NULL THEN
    RAISE EXCEPTION
      'This historical order needs verified payment reconciliation before changing delivery charges.';
  END IF;

  v_final_total := round(
    v_order.subtotal
      + CASE WHEN p_free_delivery
          THEN 0
          ELSE v_order.delivery_charge
        END,
    2
  );

  IF v_order.paid_amount > v_final_total THEN
    RAISE EXCEPTION
      'Free delivery would make paid amounts exceed the new total; resolve the overpayment before changing this order.';
  END IF;

  UPDATE public.orders
  SET free_delivery = p_free_delivery,
      total = v_final_total
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'subtotal', v_order.subtotal,
    'original_delivery_charge', v_order.delivery_charge,
    'free_delivery', v_order.free_delivery,
    'actual_delivery_charge',
      CASE WHEN v_order.free_delivery THEN 0 ELSE v_order.delivery_charge END,
    'total', v_order.total,
    'paid_amount', v_order.paid_amount,
    'due_amount', v_order.due_amount,
    'payment_status', v_order.payment_status
  );
END;
$function$;

-- Payment history is admin-readable and writable only through the
-- SECURITY DEFINER RPCs. Existing and future order/sale status workflows are
-- not replaced here.
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.sale_payments
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_payments TO authenticated;

CREATE POLICY crs_sale_payments_admin_read
  ON public.sale_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = (SELECT auth.uid())
    )
  );

-- Keep fulfillment status updates working while routing payment and
-- free-delivery changes through the locked RPCs.
REVOKE UPDATE ON public.orders FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON public.orders TO authenticated;

ALTER POLICY "Admin can update orders"
  ON public.orders
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON FUNCTION public.crs_create_direct_sale_with_payment_v1(
  text, text, text, jsonb, numeric, boolean, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crs_receive_sale_payment_v1(
  bigint, numeric, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crs_receive_order_payment_v1(
  bigint, numeric, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crs_set_order_free_delivery_v1(
  bigint, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crs_create_direct_sale_with_payment_v1(
  text, text, text, jsonb, numeric, boolean, numeric
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crs_receive_sale_payment_v1(
  bigint, numeric, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crs_receive_order_payment_v1(
  bigint, numeric, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crs_set_order_free_delivery_v1(
  bigint, boolean
) TO authenticated;

COMMIT;
