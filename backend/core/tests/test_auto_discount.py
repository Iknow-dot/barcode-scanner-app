from __future__ import annotations

from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import PurchaseOrder, PurchaseOrderItem
from core.services.auto_discount import apply_auto_discounts
from core.services.consult_web_exchange import ConsultWebExchangeError
from core.services.order_push import OrderPushError
from core.tests.common import _make_organization
from users.models import User


class ApplyAutoDiscountsTests(TestCase):
    """Pools paid lines per 1C lookup key, stores 1C's percent on each line,
    zeroes gifts, and does nothing while the org switch is off."""

    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='auto', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.client_mock = mock.Mock()
        self.client_mock.calculate_automatic_discount.return_value = {
            'items': {'A1': Decimal('10.00')}, 'document_amount': None,
            'total_discount': None, 'total_after_discount': None, 'raw': {},
        }

    def _order(self, **extra):
        defaults = dict(organization=self.org, created_by=self.user, customer_name='C',
                        customer_identification_number='01001012345')
        defaults.update(extra)
        return PurchaseOrder.objects.create(**defaults)

    def _item(self, order, *, sku='S1', article='A1', warehouse='W1', qty=1, **extra):
        return PurchaseOrderItem.objects.create(
            order=order, sku=sku, article=article, price=extra.pop('price', Decimal('10.00')),
            quantity=qty, warehouse_code=warehouse, **extra,
        )

    def _run(self, order):
        apply_auto_discounts(order, client=self.client_mock)

    def test_switch_off_is_a_noop_without_calling_1c(self):
        self.org.auto_discount_enabled = False
        self.org.save()
        order = self._order()
        line = self._item(order)
        self._run(order)
        self.client_mock.calculate_automatic_discount.assert_not_called()
        line.refresh_from_db()
        self.assertEqual(line.auto_discount_percent, Decimal('0'))

    def test_request_shape_and_stored_percent(self):
        order = self._order(notes='')
        line = self._item(order, qty=3)
        self._run(order)
        kwargs = self.client_mock.calculate_automatic_discount.call_args.kwargs
        self.assertEqual(kwargs['client_id_phone'], '01001012345')
        self.assertEqual(kwargs['user_id'], self.org.web_service_username)
        self.assertEqual(kwargs['stock_id'], 'W1')
        self.assertEqual(kwargs['comment'], f'Web order #{order.id}')
        self.assertEqual(kwargs['items'], [{
            'is_barcode': False, 'sku': 'A1', 'quantity': 3,
            'price': Decimal('10.00'), 'cost': Decimal('30.00'),
        }])
        line.refresh_from_db()
        self.assertEqual(line.auto_discount_percent, Decimal('10.00'))

    def test_two_lines_of_one_product_are_pooled_and_share_the_percent(self):
        order = self._order()
        first = self._item(order, sku='S1', qty=2)
        second = self._item(order, sku='S1-dup', qty=3)  # same article A1
        self._run(order)
        items = self.client_mock.calculate_automatic_discount.call_args.kwargs['items']
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]['quantity'], items[0]['cost']), (5, Decimal('50.00')))
        for line in (first, second):
            line.refresh_from_db()
            self.assertEqual(line.auto_discount_percent, Decimal('10.00'))

    def test_pooled_lines_with_different_prices_pool_cost_not_price(self):
        order = self._order()
        self._item(order, sku='S1', qty=1, price=Decimal('10.00'))
        self._item(order, sku='S1-dup', qty=1, price=Decimal('12.00'))  # same article A1
        self._run(order)
        items = self.client_mock.calculate_automatic_discount.call_args.kwargs['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(
            (items[0]['quantity'], items[0]['cost'], items[0]['price']),
            (2, Decimal('22.00'), Decimal('11.00')),
        )

    def test_gifts_are_not_sent_and_are_zeroed(self):
        order = self._order()
        self._item(order, qty=1)
        gift = self._item(order, sku='G', article='AG', is_gift=True, auto_discount_percent=Decimal('4'))
        self._run(order)
        items = self.client_mock.calculate_automatic_discount.call_args.kwargs['items']
        self.assertEqual([i['sku'] for i in items], ['A1'])
        gift.refresh_from_db()
        self.assertEqual(gift.auto_discount_percent, Decimal('0'))

    def test_key_missing_from_answer_is_reset_to_zero(self):
        order = self._order()
        other = self._item(order, sku='S2', article='A2', auto_discount_percent=Decimal('7'))
        self._item(order)
        self._run(order)
        other.refresh_from_db()
        self.assertEqual(other.auto_discount_percent, Decimal('0'))

    def test_gift_only_order_does_not_call_1c(self):
        order = self._order()
        self._item(order, is_gift=True)
        self._run(order)
        self.client_mock.calculate_automatic_discount.assert_not_called()

    def test_retail_uses_org_counterparty(self):
        self.org.retail_client_id_phone = '555000'
        self.org.save()
        order = self._order(is_retail=True, customer_identification_number='')
        self._item(order)
        self._run(order)
        self.assertEqual(
            self.client_mock.calculate_automatic_discount.call_args.kwargs['client_id_phone'], '555000',
        )

    def test_retail_without_counterparty_raises_no_client(self):
        order = self._order(is_retail=True, customer_identification_number='')
        self._item(order)
        with self.assertRaises(OrderPushError) as ctx:
            self._run(order)
        self.assertEqual(ctx.exception.code, 'AUTO_DISCOUNT_NO_CLIENT')
        self.client_mock.calculate_automatic_discount.assert_not_called()

    def test_mixed_warehouses_raise_before_calling_1c(self):
        order = self._order()
        self._item(order, warehouse='W1')
        self._item(order, sku='S2', article='A2', warehouse='W2')
        with self.assertRaises(OrderPushError) as ctx:
            self._run(order)
        self.assertEqual(ctx.exception.code, 'MULTIPLE_WAREHOUSES')


CALC = 'core.services.consult_web_exchange.ConsultWebExchangeClient.calculate_automatic_discount'
CREATE = 'core.services.consult_web_exchange.ConsultWebExchangeClient.create_order'
STOCK = 'core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices'


def _calc_answer(percent='10.00', sku='A1'):
    return {'items': {sku: Decimal(percent)}, 'document_amount': None,
            'total_discount': None, 'total_after_discount': None, 'raw': {}}


@override_settings(SECURE_SSL_REDIRECT=False)
class AutoDiscountPreviewEndpointTests(TestCase):
    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='prev', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='C',
            customer_identification_number='01001012345',
        )
        PurchaseOrderItem.objects.create(order=self.order, sku='S1', article='A1',
                                         price=Decimal('10.00'), quantity=2, warehouse_code='W1')

    def _post(self, order=None):
        return self.api.post(f'/api/v1/orders/{(order or self.order).id}/auto-discount/')

    @mock.patch(CALC, return_value=_calc_answer())
    def test_returns_order_with_auto_percent_and_discounted_total(self, mcalc):
        r = self._post()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['items'][0]['auto_discount_percent'], '10.00')
        self.assertEqual(str(r.data['total']), '18.00')

    @mock.patch(CALC)
    def test_other_org_order_is_404(self, mcalc):
        other = _make_organization(name='Other', identification_number='999', auto_discount_enabled=True)
        other_user = User.objects.create_user(username='o', password='p',
                                              role=User.Role.COMPANY_USER, organization=other)
        foreign = PurchaseOrder.objects.create(organization=other, created_by=other_user, customer_name='X')
        self.assertEqual(self._post(foreign).status_code, 404)
        mcalc.assert_not_called()

    @mock.patch(CALC)
    def test_non_draft_is_refused(self, mcalc):
        self.order.status = PurchaseOrder.Status.CONFIRMED
        self.order.save()
        r = self._post()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['code'], 'ORDER_NOT_DRAFT')
        mcalc.assert_not_called()

    @mock.patch(CALC, side_effect=ConsultWebExchangeError(
        code='EXTERNAL_SERVICE_TIMEOUT', detail='slow', http_status=504))
    def test_1c_failure_keeps_stored_percent(self, mcalc):
        self.order.items.update(auto_discount_percent=Decimal('5'))
        r = self._post()
        self.assertEqual(r.data['code'], 'EXTERNAL_SERVICE_TIMEOUT')
        self.assertEqual(self.order.items.get().auto_discount_percent, Decimal('5.00'))


@override_settings(SECURE_SSL_REDIRECT=False)
@mock.patch(CREATE, return_value={'success': True, 'OrderNumber': '0001'})
@mock.patch(STOCK, return_value={'stock': [{'warehouse': 'W1', 'quantity': 999}]})
class ConfirmAppliesAutoDiscountTests(TestCase):
    def setUp(self):
        self.org = _make_organization(auto_discount_enabled=True)
        self.user = User.objects.create_user(
            username='conf', password='p', role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='C',
            customer_identification_number='01001012345',
        )
        PurchaseOrderItem.objects.create(order=self.order, sku='S1', article='A1',
                                         price=Decimal('10.00'), quantity=2, warehouse_code='W1')

    def _confirm(self):
        return self.api.patch(f'/api/v1/orders/{self.order.id}/', {'status': 'confirmed'}, format='json')

    @mock.patch(CALC, return_value=_calc_answer('10.00'))
    def test_confirm_recalculates_and_sends_percent(self, mcalc, mstock, mcreate):
        self.assertEqual(self._confirm().status_code, 200)
        mcalc.assert_called_once()
        self.assertEqual(mcreate.call_args.kwargs['items'][0]['discount'], Decimal('10.00'))

    @mock.patch(CALC, side_effect=ConsultWebExchangeError(
        code='AUTO_DISCOUNT_REJECTED', detail='no', http_status=400))
    def test_calculation_failure_blocks_confirm(self, mcalc, mstock, mcreate):
        r = self._confirm()
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['code'], 'AUTO_DISCOUNT_REJECTED')
        mcreate.assert_not_called()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, PurchaseOrder.Status.DRAFT)

    @mock.patch(CALC)
    def test_already_pushed_order_is_not_recalculated(self, mcalc, mstock, mcreate):
        self.order.external_order_number = '0001'
        self.order.save()
        self._confirm()
        mcalc.assert_not_called()

    @mock.patch(CALC)
    def test_switch_off_confirms_without_calculation(self, mcalc, mstock, mcreate):
        self.org.auto_discount_enabled = False
        self.org.save()
        self.assertEqual(self._confirm().status_code, 200)
        mcalc.assert_not_called()
        self.assertEqual(mcreate.call_args.kwargs['items'][0]['discount'], Decimal('0'))
