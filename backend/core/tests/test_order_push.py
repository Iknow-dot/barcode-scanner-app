from __future__ import annotations

from core.models import Product, ProductBarcode, PurchaseOrder, PurchaseOrderItem
from core.services.consult_web_exchange import ConsultWebExchangeError
from core.services.order_push import COMMENT_MAX_LENGTH, ORDER_MARKER, order_comment
from decimal import Decimal
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient
from unittest import mock
from users.models import User
from core.tests.common import _make_organization


@override_settings(SECURE_SSL_REDIRECT=False)
@mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.create_order')
@mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
class CreateOrderOnConfirmTests(TestCase):
    """Confirming an order pushes it to 1C CreateOrder, fail closed.

    The push runs after the stock guard and before the status saves. Any
    push failure blocks the confirm (the order stays draft) — a confirmed
    order that does not exist in 1C could never be completed by the
    webhook. Skips: already-pushed orders. Retail orders with no client
    push under the org's retail counterparty, else with ClientIDPhone
    omitted (1C's own retail constant); non-retail orders with no client
    block with MISSING_CLIENT.
    """

    def setUp(self):
        self.org = _make_organization(name='OrgPush', identification_number='802')
        self.user = User.objects.create_user(
            username='pusher', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _order(self, status='draft', **extra):
        defaults = dict(
            organization=self.org, created_by=self.user,
            customer_name='Nino',
            customer_phone='+995555000111',
            customer_identification_number='01001012345',
        )
        defaults.update(extra)
        return PurchaseOrder.objects.create(status=status, **defaults)

    def _item(self, order, *, sku='S1', article='A1', warehouse='W1', qty=1, **extra):
        return PurchaseOrderItem.objects.create(
            order=order, sku=sku, sku_name=f'Name {sku}', article=article,
            price=extra.pop('price', Decimal('10.00')), quantity=qty,
            warehouse_code=warehouse, warehouse_name=f'WH {warehouse}',
            **extra,
        )

    def _confirm(self, order):
        return self.api.patch(
            f'/api/v1/orders/{order.id}/', {'status': 'confirmed'}, format='json',
        )

    @staticmethod
    def _plenty_of_stock(mstock):
        mstock.return_value = {'stock': [
            {'warehouse': code, 'quantity': 999} for code in ('W1', 'W2')
        ]}

    @staticmethod
    def _success(number='00000000051'):
        return {'success': True, 'message': 'ok', 'OrderNumber': number}

    def test_confirm_pushes_order_and_stores_order_number(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(notes='call before delivery')
        self._item(order, qty=2)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')
        self.assertEqual(order.external_order_number, '00000000051')
        self.assertEqual(r.json()['external_order_number'], '00000000051')

        kwargs = mcreate.call_args.kwargs
        self.assertEqual(kwargs['client_id_phone'], '01001012345')  # ID over phone
        self.assertEqual(kwargs['user_id'], 'svc-user')  # org web_service_username
        self.assertEqual(kwargs['stock_id'], 'W1')
        self.assertIn(f'#{order.id}', kwargs['comment'])
        self.assertIn('call before delivery', kwargs['comment'])
        self.assertEqual(kwargs['items'], [{
            'is_barcode': False,
            'sku': 'A1',
            'quantity': 2,
            'price': Decimal('10.00'),
            'cost': Decimal('20.00'),
            'discount': Decimal('0'),
            'gift': False,
        }])

    def test_client_id_falls_back_to_phone(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(customer_identification_number='')
        self._item(order)

        self._confirm(order)

        self.assertEqual(mcreate.call_args.kwargs['client_id_phone'], '+995555000111')

    def test_discounted_price_sent_as_price_with_zero_discount(self, mstock, mcreate):
        # An absolute discounted price replaces Price so 1C's Amount equals
        # our line_total exactly (a derived percent would round).
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order, qty=2, discounted_price=Decimal('8.00'),
                   discount_percent=Decimal('20.00'))

        self._confirm(order)

        item = mcreate.call_args.kwargs['items'][0]
        self.assertEqual(item['price'], Decimal('8.00'))
        self.assertEqual(item['cost'], Decimal('16.00'))
        self.assertEqual(item['discount'], Decimal('0'))

    def test_percent_discount_sent_with_base_price(self, mstock, mcreate):
        # 1C applies Discount to Cost itself: Amount = Cost × (1 − d/100).
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order, qty=2, discount_percent=Decimal('5.00'))

        self._confirm(order)

        item = mcreate.call_args.kwargs['items'][0]
        self.assertEqual(item['price'], Decimal('10.00'))
        self.assertEqual(item['cost'], Decimal('20.00'))
        self.assertEqual(item['discount'], Decimal('5.00'))

    def test_barcode_fallback_when_no_article(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        product = Product.objects.create(
            organization=self.org, sku='SKU9', name='Prod 9',
        )
        ProductBarcode.objects.create(product=product, barcode='2000000078649')
        order = self._order()
        self._item(order, sku='SKU9', article='')

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        item = mcreate.call_args.kwargs['items'][0]
        self.assertTrue(item['is_barcode'])
        self.assertEqual(item['sku'], '2000000078649')

    def test_item_without_lookup_key_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order()
        self._item(order, sku='SKU-NOKEY', article='')

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'ITEM_LOOKUP_KEY_MISSING')
        mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    def test_push_rejection_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.side_effect = ConsultWebExchangeError(
            code='ORDER_CREATE_REJECTED',
            detail='Customer not found by ClientIDPhone: 01001012345',
            http_status=400,
            upstream_status=404,
        )
        order = self._order()
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertEqual(body['code'], 'ORDER_CREATE_REJECTED')
        self.assertIn('Customer not found', body['detail'])
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')
        self.assertEqual(order.external_order_number, '')

    def test_transport_failure_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.side_effect = ConsultWebExchangeError(
            code='EXTERNAL_SERVICE_UNAVAILABLE',
            detail='Could not connect to the organization\'s web service.',
            http_status=502,
        )
        order = self._order()
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()['code'], 'EXTERNAL_SERVICE_UNAVAILABLE')
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    def test_mixed_warehouses_block_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order()
        self._item(order, warehouse='W1')
        self._item(order, sku='S2', article='A2', warehouse='W2')

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'MULTIPLE_WAREHOUSES')
        mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    def test_blank_warehouse_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order()
        self._item(order, warehouse='')

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'MISSING_WAREHOUSE')
        mcreate.assert_not_called()

    def test_empty_order_blocks_confirm(self, mstock, mcreate):
        order = self._order()

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'EMPTY_ORDER')
        mcreate.assert_not_called()

    def test_retail_order_uses_org_retail_counterparty(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        self.org.retail_client_id_phone = '999888777'
        self.org.save()
        order = self._order(
            is_retail=True, customer_name='', customer_phone='',
            customer_identification_number='',
        )
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        self.assertEqual(mcreate.call_args.kwargs['client_id_phone'], '999888777')

    def test_retail_order_without_setting_pushes_clientless(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(
            is_retail=True, customer_name='', customer_phone='',
            customer_identification_number='',
        )
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        self.assertEqual(mcreate.call_args.kwargs['client_id_phone'], '')
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')
        self.assertEqual(order.external_order_number, '00000000051')

    def test_non_retail_order_without_client_blocks_confirm(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order(
            customer_name='', customer_phone='',
            customer_identification_number='',
        )
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'MISSING_CLIENT')
        mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    def test_already_pushed_order_skips_push(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        order = self._order(external_order_number='00000000042')
        self._item(order)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.external_order_number, '00000000042')

    def test_stock_shortage_blocks_before_push(self, mstock, mcreate):
        mstock.return_value = {'stock': [{'warehouse': 'W1', 'quantity': 1}]}
        order = self._order()
        self._item(order, qty=5)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'INSUFFICIENT_STOCK')
        mcreate.assert_not_called()

    def test_external_order_number_not_writable_via_api(self, mstock, mcreate):
        order = self._order()
        self._item(order)

        r = self.api.patch(
            f'/api/v1/orders/{order.id}/',
            {'external_order_number': '00000000099'},
            format='json',
        )

        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.external_order_number, '')

    def test_gift_line_sent_with_gift_flag_and_normal_pricing(self, mstock, mcreate):
        # The 1C service reads a per-item `Gift` and sets the document row's
        # `Подарок` (confirmed from its source 2026-09-22; the older probe
        # behind ClickUp 86cakz72m predates that). Our mark stays
        # informational, so the pricing we send is unchanged.
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order()
        self._item(order)
        self._item(order, sku='S2', article='A2', is_gift=True)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        items = mcreate.call_args.kwargs['items']
        self.assertEqual(len(items), 2)
        self.assertIs(items[0]['gift'], False)
        self.assertEqual(items[1]['sku'], 'A2')
        self.assertIs(items[1]['gift'], True)
        self.assertEqual(items[1]['price'], Decimal('10.00'))

    def test_comment_ends_with_the_marker_so_notes_cannot_corrupt_the_order_id(
        self, mstock, mcreate,
    ):
        # 1C finds "Web order #" and then keeps EVERY digit after it
        # (ИзвлечьOrderIDИзКомментария → ТолькоЦифрыИзСтроки), registering
        # the exchange under that number — which is what the completion
        # webhook keys on. With the notes after the marker,
        # "Web order #42 — 5 boxes by 18:00" registers as order 4251800.
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(notes='5 boxes by 18:00')
        self._item(order)

        self._confirm(order)

        comment = mcreate.call_args.kwargs['comment']
        self.assertTrue(comment.endswith(f'Web order #{order.id}'), comment)
        self.assertIn('5 boxes by 18:00', comment)
        self.assertEqual(_order_id_1c_reads(comment), str(order.id))

    def test_notes_with_their_own_marker_cannot_hijack_the_order_id(self, mstock, mcreate):
        # 1C matches the FIRST occurrence of the marker, so a note that
        # repeats it (a consultant pasting an older reference) would win.
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(notes='replaces Web order #999')
        self._item(order)

        self._confirm(order)

        comment = mcreate.call_args.kwargs['comment']
        self.assertEqual(_order_id_1c_reads(comment), str(order.id))

    def test_long_notes_are_truncated_but_the_marker_survives(self, mstock, mcreate):
        self._plenty_of_stock(mstock)
        mcreate.return_value = self._success()
        order = self._order(notes='x' * 900)
        self._item(order)

        self._confirm(order)

        comment = mcreate.call_args.kwargs['comment']
        self.assertLessEqual(len(comment), 500)
        self.assertTrue(comment.endswith(f'Web order #{order.id}'), comment[-40:])


def _order_id_1c_reads(comment):
    """The id 1C registers for `comment`, as its digit string (None = 400).

    A line-for-line mirror of ``ИзвлечьOrderIDИзКомментария``: trim
    (``СокрЛП``), find the FIRST ``Web order #`` (``Найти``, case-sensitive),
    then keep every ASCII digit anywhere after it (``ТолькоЦифрыИзСтроки``
    tests each character against "0123456789", so ``str.isdigit`` — which
    also accepts ``²`` or ``٣`` — would be the wrong model).
    """
    text = comment.strip()
    position = text.find(ORDER_MARKER)
    if position < 0:
        return None
    rest = text[position + len(ORDER_MARKER):]
    digits = ''.join(c for c in rest if c in '0123456789')
    return digits or None


class OrderCommentTests(SimpleTestCase):
    """``order_comment`` must leave exactly one marker, ours, at the very end.

    1C reads the id from the first marker onwards, so anything in the notes
    that survives as a marker — or that sits after ours — changes the order
    the completion webhook completes.
    """

    ORDER_ID = 4217

    def _comment(self, notes):
        return order_comment(PurchaseOrder(id=self.ORDER_ID, notes=notes))

    def assertOnlyOurMarker(self, comment):
        self.assertEqual(comment.count(ORDER_MARKER), 1, comment)
        self.assertTrue(comment.endswith(f'{ORDER_MARKER}{self.ORDER_ID}'), comment[-40:])
        self.assertEqual(_order_id_1c_reads(comment), str(self.ORDER_ID), comment)
        self.assertLessEqual(len(comment), COMMENT_MAX_LENGTH)

    def test_no_notes_is_the_bare_marker(self):
        for notes in ('', None, '   \n\t '):
            with self.subTest(notes=notes):
                self.assertEqual(self._comment(notes), f'Web order #{self.ORDER_ID}')

    def test_ordinary_notes_are_kept_verbatim_before_the_marker(self):
        comment = self._comment('Order #5 — 5 boxes by 18:00')
        self.assertEqual(comment, f'Order #5 — 5 boxes by 18:00 — Web order #{self.ORDER_ID}')
        self.assertOnlyOurMarker(comment)

    def test_a_run_of_hashes_cannot_reassemble_the_marker(self):
        # Replacing "Web order #" once turns "Web order ##999" back into
        # "Web order #999" — the marker 1C matches first — and 1C would
        # register the order as 999 followed by our own id's digits.
        for notes in (
            'Web order ##999',
            'Web order ###999',
            'see Web order ' + '#' * 200 + '999',
        ):
            with self.subTest(notes=notes[:40]):
                self.assertOnlyOurMarker(self._comment(notes))

    def test_repeated_and_nested_markers_are_all_defanged(self):
        for notes in (
            'replaces Web order #999',
            'Web order #1, then Web order ##2',
            'Web order #Web order #5',
            'Web order Web order ##5',
            # This order's own reference pasted into its notes still has to
            # go: a second marker would put the notes' digits after the first.
            f'Web order #{self.ORDER_ID}',
            # 1C's `Найти` is case-sensitive, so this one is inert as it is.
            'web order #999',
        ):
            with self.subTest(notes=notes):
                self.assertOnlyOurMarker(self._comment(notes))

    def test_a_marker_on_the_truncation_boundary_cannot_survive(self):
        # Only the notes are truncated. Whatever the cut keeps must hold no
        # marker, whether the cut lands inside the phrase, on the hash run,
        # or just after it.
        marker = f'Web order #{self.ORDER_ID}'
        room = COMMENT_MAX_LENGTH - len(marker) - len(' — ')
        for offset in range(0, 16):
            notes = 'x' * (room - offset) + 'Web order ##999' + 'y' * 50
            with self.subTest(offset=offset):
                self.assertOnlyOurMarker(self._comment(notes))

    def test_a_note_ending_in_the_phrase_cannot_join_the_separator_into_a_marker(self):
        for notes in ('call Web order', 'call Web order ', 'call Web order #'):
            with self.subTest(notes=notes):
                self.assertOnlyOurMarker(self._comment(notes))


@override_settings(SECURE_SSL_REDIRECT=False)
class ConfirmStockGuardTests(TestCase):
    """Confirming an order re-checks live 1C free stock per line (ClickUp 86ca5rubt).

    The guard blocks the draft→confirmed transition when any line requests
    more than the free stock 1C reports for its warehouse. Lines that cannot
    be verified (no article/barcode lookup key, blank warehouse, upstream
    outage) fail OPEN so a 1C incident never freezes the sales floor.
    The fail-open applies to the stock check only — every confirm now pushes
    to 1C, so a line that cannot be sent (no lookup key, blank warehouse)
    still blocks at the push guards.
    """

    def setUp(self):
        self.org = _make_organization(name='OrgS', identification_number='801')
        self.user = User.objects.create_user(
            username='stockguard', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        # Mock create_order for retail order pushes in confirm tests
        self.mcreate_patcher = mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.create_order')
        self.mcreate = self.mcreate_patcher.start()
        self.mcreate.return_value = {'success': True, 'message': 'ok', 'OrderNumber': '00000000099'}

    def tearDown(self):
        self.mcreate_patcher.stop()

    def _order(self, status='draft'):
        return PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Nino', is_retail=True, status=status,
        )

    def _item(self, order, *, sku='S1', article='A1', warehouse='W1', qty=1, **extra):
        return PurchaseOrderItem.objects.create(
            order=order, sku=sku, sku_name=f'Name {sku}', article=article,
            price='10.00', quantity=qty,
            warehouse_code=warehouse, warehouse_name=f'WH {warehouse}',
            **extra,
        )

    def _confirm(self, order):
        return self.api.patch(
            f'/api/v1/orders/{order.id}/', {'status': 'confirmed'}, format='json',
        )

    @staticmethod
    def _stock(*rows):
        return {'stock': [
            {'warehouse': code, 'warehouse_name': f'WH {code}', 'quantity': qty, 'price': '10.00'}
            for code, qty in rows
        ]}

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_confirm_blocked_when_free_stock_insufficient(self, mstock):
        mstock.return_value = self._stock(('W1', 3))
        order = self._order()
        self._item(order, qty=5)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertEqual(body['code'], 'INSUFFICIENT_STOCK')
        self.assertEqual(len(body['items']), 1)
        short = body['items'][0]
        self.assertEqual(short['sku'], 'S1')
        self.assertEqual(short['warehouse_code'], 'W1')
        self.assertEqual(Decimal(short['requested']), Decimal(5))
        self.assertEqual(Decimal(short['available']), Decimal(3))
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_confirm_allowed_when_stock_sufficient(self, mstock):
        mstock.return_value = self._stock(('W1', 5))
        order = self._order()
        self._item(order, qty=3)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')
        mstock.assert_called_once_with('A1', is_barcode=False, warehouses='W1')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_lines_of_same_sku_and_warehouse_are_summed(self, mstock):
        mstock.return_value = self._stock(('W1', 3))
        order = self._order()
        self._item(order, qty=2)
        self._item(order, qty=2)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'INSUFFICIENT_STOCK')
        self.assertEqual(Decimal(r.json()['items'][0]['requested']), Decimal(4))

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_gift_lines_consume_stock_too(self, mstock):
        mstock.return_value = self._stock(('W1', 3))
        order = self._order()
        self._item(order, qty=2)
        self._item(order, qty=2, is_gift=True)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'INSUFFICIENT_STOCK')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_missing_warehouse_row_counts_as_zero(self, mstock):
        # 1C answered, but reported no row for the line's warehouse — that IS
        # the answer "0 free there", not an unverifiable line.
        mstock.return_value = self._stock(('W2', 10))
        order = self._order()
        self._item(order, qty=1, warehouse='W1')

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(Decimal(r.json()['items'][0]['available']), Decimal(0))

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_fractional_free_stock_is_compared_exactly(self, mstock):
        mstock.return_value = self._stock(('W1', '2.5'))
        order = self._order()
        self._item(order, qty=3)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(Decimal(r.json()['items'][0]['available']), Decimal('2.5'))

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_confirm_fails_open_when_service_unreachable(self, mstock):
        mstock.side_effect = ConsultWebExchangeError(
            code='EXTERNAL_SERVICE_TIMEOUT', detail='t', http_status=504,
        )
        order = self._order()
        self._item(order, qty=999)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_stock_guard_skips_line_without_lookup_key_push_still_blocks(self, mstock):
        # No article on the line and no replica product/barcode to fall back
        # to — the line is unverifiable, so the stock guard must not block
        # (or even call 1C). The push guard then rejects the confirm: every
        # confirm now pushes, and this line cannot be sent to 1C.
        order = self._order()
        self._item(order, article='', qty=999)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'ITEM_LOOKUP_KEY_MISSING')
        mstock.assert_not_called()
        self.mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_stock_guard_skips_line_without_warehouse_push_still_blocks(self, mstock):
        order = self._order()
        self._item(order, warehouse='', qty=999)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'MISSING_WAREHOUSE')
        mstock.assert_not_called()
        self.mcreate.assert_not_called()
        order.refresh_from_db()
        self.assertEqual(order.status, 'draft')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_replica_barcode_is_lookup_fallback_when_no_article(self, mstock):
        p = Product.objects.create(organization=self.org, sku='S1', name='Candle', price='10.00')
        ProductBarcode.objects.create(product=p, barcode='4870001')
        mstock.return_value = self._stock(('W1', 10))
        order = self._order()
        self._item(order, article='', qty=1)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        mstock.assert_called_once_with('4870001', is_barcode=True, warehouses='W1')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_non_status_patch_does_not_call_service(self, mstock):
        order = self._order()
        self._item(order, qty=999)

        r = self.api.patch(
            f'/api/v1/orders/{order.id}/', {'notes': 'call before delivery'}, format='json',
        )

        self.assertEqual(r.status_code, 200)
        mstock.assert_not_called()

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_patch_to_same_confirmed_status_does_not_call_service(self, mstock):
        order = self._order(status='confirmed')
        self._item(order, qty=999)

        r = self._confirm(order)

        self.assertEqual(r.status_code, 200)
        mstock.assert_not_called()
