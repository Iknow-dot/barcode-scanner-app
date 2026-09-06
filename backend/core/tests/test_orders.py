from __future__ import annotations

from core.models import PurchaseOrder, PurchaseOrderItem
from core.serializers import PurchaseOrderSerializer
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from unittest import mock
from users.models import User
from core.tests.common import _make_organization


class PurchaseOrderDenormalizedSearchTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='u1', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Nino Beridze', customer_phone='+995555',
            customer_identification_number='11111',
        )
        PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Giorgi Tabidze', customer_phone='+995777',
            customer_identification_number='22222',
        )

    def test_filter_by_external_client_id(self):
        PurchaseOrder.objects.filter(customer_name='Nino Beridze').update(
            external_client_id='EXT-A',
        )
        qs = PurchaseOrder.objects.filter(external_client_id='EXT-A')
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first().customer_name, 'Nino Beridze')

    def test_filter_by_customer_search_name(self):
        from django.db.models import Q
        qs = PurchaseOrder.objects.filter(
            Q(customer_name__icontains='nino')
            | Q(customer_phone__icontains='nino')
            | Q(customer_identification_number__icontains='nino')
        )
        self.assertEqual([o.customer_name for o in qs], ['Nino Beridze'])

    def test_purchase_order_serializer_round_trip(self):
        order = PurchaseOrder.objects.first()
        data = PurchaseOrderSerializer(order).data
        self.assertIn('customer_name', data)
        self.assertIn('external_client_id', data)
        self.assertNotIn('customer', data)


class BulkUpdateOrderItemsSerializerTests(TestCase):
    def test_rejects_empty_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [], 'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_missing_item_ids(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'data': {'price': '10.00'}})
        self.assertFalse(s.is_valid())
        self.assertIn('item_ids', s.errors)

    def test_rejects_empty_data(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={'item_ids': [1, 2], 'data': {}})
        self.assertFalse(s.is_valid())
        self.assertIn('data', s.errors)

    def test_accepts_valid_payload(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1, 2, 3],
            'data': {'price': '12.50', 'unit': 'piece', 'discount_percent': '5.00'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data['item_ids'], [1, 2, 3])
        self.assertEqual(s.validated_data['data']['unit'], 'piece')

    def test_accepts_discounted_price_null(self):
        from core.serializers import BulkUpdateOrderItemsSerializer
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1],
            'data': {'discounted_price': None, 'discount_percent': '0'},
        })
        self.assertTrue(s.is_valid(), s.errors)
        self.assertIsNone(s.validated_data['data']['discounted_price'])

    def test_rejects_quantity_field(self):
        """quantity is intentionally NOT in the bulk-update whitelist —
        per-warehouse qty has its own update_item endpoint."""
        from core.serializers import BulkUpdateOrderItemsSerializer
        # quantity-only payload should be treated as empty data and rejected
        s = BulkUpdateOrderItemsSerializer(data={
            'item_ids': [1],
            'data': {'quantity': 5},
        })
        self.assertFalse(s.is_valid())
        self.assertIn('data', s.errors)


@override_settings(SECURE_SSL_REDIRECT=False)
class PurchaseOrderBulkUpdateTests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='consultant', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
            can_apply_discount=True, max_discount_percent=20,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Cust',
        )
        self.item_a = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=2, warehouse_code='WHA',
            warehouse_name='WH-A',
        )
        self.item_b = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=3, warehouse_code='WHB',
            warehouse_name='WH-B',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/orders/{self.order.id}/items/bulk-update/'

    def test_bulk_update_price_applies_to_listed_items(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '90.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '90.00')
        self.assertEqual(str(self.item_b.price), '90.00')

    def test_bulk_update_returns_refreshed_order_with_recomputed_total(self):
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '50.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        # 2 * 50 + 3 * 50 = 250
        self.assertEqual(str(response.data['total']), '250.00')
        self.assertEqual(len(response.data['items']), 2)
        for item in response.data['items']:
            self.assertEqual(str(item['price']), '50.00')

    def test_bulk_update_silently_skips_ids_not_in_this_order(self):
        # An item from a *different* order in the same org — must NOT be touched.
        other_order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='Other',
        )
        other_item = PurchaseOrderItem.objects.create(
            order=other_order, sku='SKU2', price='999.00', quantity=1,
        )
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, other_item.id],
             'data': {'price': '11.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.item_a.refresh_from_db()
        other_item.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '11.00')
        self.assertEqual(str(other_item.price), '999.00')

    def test_discount_denial_rolls_back_whole_batch(self):
        # Make item_b pricier so the same discounted_price implies a much
        # larger discount on it. With cap=30: item_a's 20% passes (and is
        # save()'d), item_b's 60% is denied. Without atomic rollback,
        # item_a's discounted_price would persist as 80.00.
        self.item_b.price = '200.00'
        self.item_b.save()
        self.user.max_discount_percent = 30
        self.user.save()

        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'discounted_price': '80.00'}},
            format='json',
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data['code'], 'DISCOUNT_EXCEEDS_LIMIT')
        # item_b is the one that exceeded the cap, so it's the failed_item_id.
        self.assertEqual(response.data['failed_item_id'], self.item_b.id)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        # item_a passed validation and was save()'d in iteration 1 — only
        # transaction.atomic() rolling back can keep its discounted_price None.
        self.assertIsNone(self.item_a.discounted_price)
        self.assertIsNone(self.item_b.discounted_price)

    def test_rejects_discounted_price_above_base(self):
        # Regression for ClickUp 86c9n9exd: setting `discounted_price` higher
        # than `price` previously slipped past the discount-cap check (since
        # it isn't a "discount") and inflated the line total via
        # PurchaseOrderItem.effective_price, producing invoices whose total
        # exceeded the product price. The validator now rejects it with 400.
        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id],
             'data': {'discounted_price': '150.00', 'discount_percent': '0'}},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data['code'], 'DISCOUNTED_PRICE_ABOVE_BASE')
        self.item_a.refresh_from_db()
        self.assertIsNone(self.item_a.discounted_price)

    def test_other_org_order_returns_404(self):
        other_org = _make_organization(name='Other', identification_number='999')
        other_user = User.objects.create_user(
            username='outsider', password='p',
            role=User.Role.COMPANY_USER, organization=other_org,
        )
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)
        response = other_client.patch(
            self.url,  # this points at self.org's order
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'price': '1.00'}},
            format='json',
        )
        # PurchaseOrderViewSet.get_queryset filters by user.organization, so a
        # cross-org order is invisible (404), not a 403. Both items must be
        # untouched — neither id should ever reach the filter().
        self.assertEqual(response.status_code, 404)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(str(self.item_a.price), '100.00')
        self.assertEqual(str(self.item_b.price), '100.00')

    def test_unit_only_change_does_not_trigger_discount_check(self):
        # Pre-existing 15% discount on item_a. Without the is_changing_discount
        # short-circuit, _enforce_discount_permission would be invoked with
        # the existing 15% and (since can_apply_discount=False) deny — so a
        # *unit-only* edit would 403, breaking routine line edits.
        self.item_a.discount_percent = '15.00'
        self.item_a.save()
        self.user.can_apply_discount = False
        self.user.save()

        response = self.client.patch(
            self.url,
            {'item_ids': [self.item_a.id, self.item_b.id],
             'data': {'unit': 'box'}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item_a.refresh_from_db()
        self.item_b.refresh_from_db()
        self.assertEqual(self.item_a.unit, 'box')
        self.assertEqual(self.item_b.unit, 'box')
        # The pre-existing discount must survive — we only touched unit.
        self.assertEqual(str(self.item_a.discount_percent), '15.00')


class PurchaseOrderRetailFieldTests(TestCase):
    def test_is_retail_defaults_false(self):
        org = _make_organization()
        order = PurchaseOrder.objects.create(organization=org)
        self.assertFalse(order.is_retail)


@override_settings(SECURE_SSL_REDIRECT=False)
class RetailOrderAPITests(TestCase):
    def setUp(self):
        self.org = _make_organization()
        self.user = User.objects.create_user(
            username='retail-u', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.url = reverse('order-list')

    def test_retail_order_created_without_customer_name(self):
        response = self.api.post(self.url, {'is_retail': True}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['is_retail'])
        order = PurchaseOrder.objects.get(pk=response.data['id'])
        self.assertTrue(order.is_retail)
        self.assertEqual(order.customer_name, '')
        self.assertEqual(order.external_client_id, '')

    def test_non_retail_order_still_requires_customer_name(self):
        response = self.api.post(self.url, {'customer_phone': '555123456'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('customer_name', response.data)

    def test_retail_order_blanks_stray_customer_fields(self):
        response = self.api.post(
            self.url,
            {'is_retail': True, 'customer_name': 'Should Be Dropped',
             'customer_identification_number': '99999'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        order = PurchaseOrder.objects.get(pk=response.data['id'])
        self.assertEqual(order.customer_name, '')
        self.assertEqual(order.customer_identification_number, '')

    def test_two_retail_orders_are_distinct_drafts(self):
        r1 = self.api.post(self.url, {'is_retail': True}, format='json')
        r2 = self.api.post(self.url, {'is_retail': True}, format='json')
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertNotEqual(r1.data['id'], r2.data['id'])

    def test_attaching_client_clears_retail_flag(self):
        created = self.api.post(self.url, {'is_retail': True}, format='json')
        order_id = created.data['id']
        detail_url = reverse('order-detail', kwargs={'pk': order_id})
        response = self.api.patch(
            detail_url,
            {'customer_name': 'Nino Beridze', 'is_retail': False},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        order = PurchaseOrder.objects.get(pk=order_id)
        self.assertFalse(order.is_retail)
        self.assertEqual(order.customer_name, 'Nino Beridze')

    def test_delivery_only_patch_on_normal_order_keeps_customer(self):
        created = self.api.post(self.url, {'customer_name': 'Giorgi Beridze'}, format='json')
        order_id = created.data['id']
        detail_url = reverse('order-detail', kwargs={'pk': order_id})
        response = self.api.patch(
            detail_url, {'delivery_notes': 'call before arriving'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['customer_name'], 'Giorgi Beridze')


@override_settings(SECURE_SSL_REDIRECT=False)
class RetailOrderListSerializerTests(TestCase):
    def test_list_response_includes_is_retail(self):
        org = _make_organization()
        user = User.objects.create_user(
            username='list-u', password='p',
            role=User.Role.COMPANY_USER, organization=org,
        )
        PurchaseOrder.objects.create(organization=org, created_by=user, is_retail=True)
        api = APIClient()
        api.force_authenticate(user)
        response = api.get(reverse('order-list'))
        self.assertEqual(response.status_code, 200)
        results = response.data['results'] if 'results' in response.data else response.data
        self.assertIn('is_retail', results[0])
        self.assertTrue(results[0]['is_retail'])


class PurchaseOrderCompletedStatusTests(TestCase):
    def test_completed_is_a_valid_status(self):
        org = _make_organization(name='OrgS', identification_number='900')
        order = PurchaseOrder.objects.create(
            organization=org, customer_name='Nino', status=PurchaseOrder.Status.COMPLETED,
        )
        order.full_clean(exclude=['created_by'])  # choices validation; created_by is blank=False (pre-existing model constraint, out of scope)
        self.assertEqual(order.status, 'completed')


@override_settings(SECURE_SSL_REDIRECT=False)
class OrderStatusGuardTests(TestCase):
    def setUp(self):
        self.org = _make_organization(name='OrgG', identification_number='800')
        self.user = User.objects.create_user(
            username='guard', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def _order(self, status='confirmed'):
        return PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user,
            customer_name='Nino', status=status,
        )

    def _patch(self, order, body):
        return self.api.patch(f'/api/v1/orders/{order.id}/', body, format='json')

    def test_user_cannot_set_completed(self):
        order = self._order(status='confirmed')
        r = self._patch(order, {'status': 'completed'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'STATUS_NOT_SETTABLE')
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')

    def test_user_cannot_change_status_of_completed_order(self):
        order = self._order(status='completed')
        r = self._patch(order, {'status': 'draft'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'ORDER_COMPLETED_LOCKED')
        order.refresh_from_db()
        self.assertEqual(order.status, 'completed')

    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.create_order')
    @mock.patch('core.services.consult_web_exchange.ConsultWebExchangeClient.get_stock_and_prices')
    def test_normal_status_transitions_still_work(self, mstock, mcreate):
        mstock.return_value = {'stock': [{'warehouse': 'W1', 'quantity': 999}]}
        mcreate.return_value = {'success': True, 'message': 'ok', 'OrderNumber': '00000000077'}
        order = self._order(status='draft')
        # Every confirm now pushes to 1C — the order needs a client and a
        # pushable line (article + warehouse) to exercise the happy path.
        order.customer_phone = '+995555000111'
        order.save(update_fields=['customer_phone', 'updated_at'])
        PurchaseOrderItem.objects.create(
            order=order, sku='S-guard', article='A-guard', quantity=1,
            price='10.00', warehouse_code='W1', warehouse_name='WH W1',
        )
        r = self._patch(order, {'status': 'confirmed'})
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, 'confirmed')

    def test_non_status_edit_on_completed_order_is_allowed(self):
        # Spec locks the STATUS of a completed order; other fields (e.g. notes)
        # remain editable for now.
        order = self._order(status='completed')
        r = self._patch(order, {'notes': 'delivered to reception'})
        self.assertEqual(r.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.notes, 'delivered to reception')
        self.assertEqual(order.status, 'completed')

    def test_user_cannot_create_order_as_completed(self):
        r = self.api.post(
            '/api/v1/orders/',
            {'customer_name': 'Nino', 'status': 'completed'},
            format='json',
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'STATUS_NOT_SETTABLE')
        self.assertFalse(
            PurchaseOrder.objects.filter(organization=self.org, status='completed').exists()
        )

    def test_user_cannot_delete_completed_order(self):
        order = self._order(status='completed')
        r = self.api.delete(f'/api/v1/orders/{order.id}/')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['code'], 'ORDER_COMPLETED_LOCKED')
        self.assertTrue(PurchaseOrder.objects.filter(pk=order.id).exists())

    def test_user_can_still_delete_draft_order(self):
        order = self._order(status='draft')
        r = self.api.delete(f'/api/v1/orders/{order.id}/')
        self.assertEqual(r.status_code, 204)
        self.assertFalse(PurchaseOrder.objects.filter(pk=order.id).exists())

    def test_list_body_returns_400_not_500(self):
        order = self._order(status='confirmed')
        r = self.api.patch(f'/api/v1/orders/{order.id}/', ['not', 'a', 'dict'], format='json')
        self.assertEqual(r.status_code, 400)


class GiftFlagModelTests(TestCase):
    def test_defaults_are_off(self):
        org = _make_organization()
        self.assertFalse(org.gift_marking_enabled)
        order = PurchaseOrder.objects.create(organization=org, customer_name='C')
        item = PurchaseOrderItem.objects.create(order=order, sku='S1', price='10.00')
        self.assertFalse(item.is_gift)

    def test_gift_does_not_change_line_total(self):
        org = _make_organization()
        order = PurchaseOrder.objects.create(organization=org, customer_name='C')
        item = PurchaseOrderItem.objects.create(
            order=order, sku='S1', price='10.00', quantity=3, is_gift=True,
        )
        item.refresh_from_db()  # coerce the string price to Decimal, as any DB read does
        self.assertEqual(str(item.line_total), '30.00')
        self.assertEqual(str(order.total), '30.00')


@override_settings(SECURE_SSL_REDIRECT=False)
class GiftFlagEndpointTests(TestCase):
    def setUp(self):
        self.org = _make_organization(gift_marking_enabled=True)
        self.user = User.objects.create_user(
            username='gift-consultant', password='p',
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.order = PurchaseOrder.objects.create(
            organization=self.org, created_by=self.user, customer_name='Cust',
        )
        self.item = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=2, warehouse_code='WHA',
            warehouse_name='WH-A',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _update_url(self, item_id):
        return f'/api/v1/orders/{self.order.id}/items/{item_id}/update/'

    def _disable_gifts(self):
        self.org.gift_marking_enabled = False
        self.org.save(update_fields=['gift_marking_enabled'])

    def test_update_item_sets_gift_and_keeps_totals(self):
        before_total = str(self.order.total)
        response = self.client.patch(
            self._update_url(self.item.id), {'is_gift': True}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item.refresh_from_db()
        self.assertTrue(self.item.is_gift)
        self.assertEqual(str(self.order.total), before_total)
        returned = next(
            i for i in response.data['items'] if i['id'] == self.item.id
        )
        self.assertTrue(returned['is_gift'])

    def test_update_item_gift_rejected_when_org_disabled(self):
        self._disable_gifts()
        response = self.client.patch(
            self._update_url(self.item.id), {'is_gift': True}, format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'GIFT_NOT_ENABLED')
        self.item.refresh_from_db()
        self.assertFalse(self.item.is_gift)

    def test_clearing_gift_allowed_when_org_disabled(self):
        self.item.is_gift = True
        self.item.save(update_fields=['is_gift'])
        self._disable_gifts()
        response = self.client.patch(
            self._update_url(self.item.id), {'is_gift': False}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item.refresh_from_db()
        self.assertFalse(self.item.is_gift)

    def test_add_item_with_gift(self):
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU9', 'price': '5.00', 'quantity': 1,
             'warehouse_code': 'WHZ', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        created = self.order.items.get(sku='SKU9')
        self.assertTrue(created.is_gift)

    def test_add_item_gift_rejected_when_org_disabled(self):
        self._disable_gifts()
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU9', 'price': '5.00', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'GIFT_NOT_ENABLED')
        self.assertFalse(self.order.items.filter(sku='SKU9').exists())

    def test_bulk_update_sets_gift(self):
        other = PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', price='100.00', quantity=1,
            warehouse_code='WHB', warehouse_name='WH-B',
        )
        response = self.client.patch(
            f'/api/v1/orders/{self.order.id}/items/bulk-update/',
            {'item_ids': [self.item.id, other.id], 'data': {'is_gift': True}},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.item.refresh_from_db()
        other.refresh_from_db()
        self.assertTrue(self.item.is_gift)
        self.assertTrue(other.is_gift)

    def test_bulk_update_gift_rejected_when_org_disabled(self):
        self._disable_gifts()
        response = self.client.patch(
            f'/api/v1/orders/{self.order.id}/items/bulk-update/',
            {'item_ids': [self.item.id], 'data': {'is_gift': True}},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'GIFT_NOT_ENABLED')
        self.item.refresh_from_db()
        self.assertFalse(self.item.is_gift)

    def test_add_gift_line_does_not_merge_into_paid_line(self):
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 2)
        self.item.refresh_from_db()
        self.assertFalse(self.item.is_gift)
        self.assertEqual(self.item.quantity, 2)
        gift_line = lines.get(is_gift=True)
        self.assertEqual(gift_line.quantity, 1)

    def test_add_paid_line_still_merges_into_paid_line(self):
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 1)
        self.item.refresh_from_db()
        self.assertEqual(self.item.quantity, 3)

    def test_add_gift_line_merges_into_existing_gift_line(self):
        PurchaseOrderItem.objects.create(
            order=self.order, sku='SKU1', sku_name='Widget',
            price='100.00', quantity=1, warehouse_code='WHA',
            warehouse_name='WH-A', is_gift=True,
        )
        response = self.client.post(
            f'/api/v1/orders/{self.order.id}/items/',
            {'sku': 'SKU1', 'price': '100.00', 'quantity': 1,
             'warehouse_code': 'WHA', 'is_gift': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        lines = self.order.items.filter(sku='SKU1', warehouse_code='WHA')
        self.assertEqual(lines.count(), 2)
        gift_line = lines.get(is_gift=True)
        self.assertEqual(gift_line.quantity, 2)
