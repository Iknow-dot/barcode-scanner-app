import React, {useCallback, useId} from 'react';
import dayjs from 'dayjs';
import {DatePicker, Input, Segmented, TimePicker} from 'antd';
import {orderService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import displayCustomerName from '../../utils/orderDisplay';
import IosIcon from '../Common/IosIcon';
import useDebouncedField from './useDebouncedField';
import {cartItemCount, orderWarehouseNames} from './cartSheetView';
import {
    dateValue,
    isDeliveryOrder,
    recipientPatch,
    recipientPhoneValid,
    timeValue,
} from './deliveryView';

const {TextArea} = Input;

/**
 * Step 2 of the order sheet: pickup or delivery, the recipient, the delivery
 * address, date and time window and notes, the order comment, and a summary.
 * Every field saves to the order as OrderPanel's delivery and notes sections
 * did — the same fields, debounce, and phone rule.
 */
const DeliveryStep = ({order, onOrderUpdate, notify}) => {
    const {t} = useLanguage();
    const recipientLabelId = useId();

    const save = useCallback(async (patch) => {
        const result = await orderService.updateOrder(order.id, patch);
        if (result.success) onOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [order.id, onOrderUpdate, notify, t]);

    const [address, setAddress, flushAddress] = useDebouncedField(
        order.delivery_address || '',
        useCallback((value) => save({delivery_address: value || ''}), [save]),
    );
    const [deliveryNotes, setDeliveryNotes, flushDeliveryNotes] = useDebouncedField(
        order.delivery_notes || '',
        useCallback((value) => save({delivery_notes: value || ''}), [save]),
    );
    const [notes, setNotes, flushNotes] = useDebouncedField(
        order.notes || '',
        useCallback((value) => save({notes: value || ''}), [save]),
    );
    const [recipientFirst, setRecipientFirst, flushRecipientFirst] = useDebouncedField(
        order.recipient_first_name || '',
        useCallback((value) => save({recipient_first_name: value || ''}), [save]),
    );
    const [recipientLast, setRecipientLast, flushRecipientLast] = useDebouncedField(
        order.recipient_last_name || '',
        useCallback((value) => save({recipient_last_name: value || ''}), [save]),
    );
    const [recipientPhone, setRecipientPhone, flushRecipientPhone] = useDebouncedField(
        order.recipient_phone || '',
        useCallback((value) => save({recipient_phone: value || ''}), [save]),
    );

    const delivery = isDeliveryOrder(order);
    const recipientIsDifferent = !!order.recipient_is_different;
    const phoneValid = recipientPhoneValid(recipientPhone);

    return (
        <>
            <Segmented
                className="if-seg"
                block
                aria-label={t.deliveryType}
                value={order.delivery_type || 'pickup'}
                onChange={(value) => save({delivery_type: value})}
                options={[
                    {label: t.pickup, value: 'pickup'},
                    {label: t.delivery, value: 'delivery'},
                ]}
            />

            <div className="if-group is-lead-inset m-delivery-group">
                {delivery && (
                    <div className="if-row m-field-row">
                        <span className="if-row-icon"><IosIcon name="pin" size={22}/></span>
                        <div className="if-row-main">
                            <span className="if-field-label">{t.deliveryAddress}</span>
                            <TextArea
                                variant="borderless"
                                className="if-field-input"
                                aria-label={t.deliveryAddress}
                                placeholder={t.notSet}
                                autoSize={{minRows: 1, maxRows: 3}}
                                value={address}
                                onChange={(event) => setAddress(event.target.value)}
                                onBlur={flushAddress}
                            />
                        </div>
                    </div>
                )}

                <div className="if-row">
                    <span className="if-row-icon"><IosIcon name="person" size={22}/></span>
                    <span className="if-row-label" id={recipientLabelId}>{t.recipient}</span>
                    <Segmented
                        className="if-seg is-inset m-recipient-seg"
                        aria-labelledby={recipientLabelId}
                        value={recipientIsDifferent ? 'different' : 'same'}
                        onChange={(value) => save(recipientPatch(value))}
                        options={[
                            {label: t.recipientSame, value: 'same'},
                            {label: t.recipientDifferent, value: 'different'},
                        ]}
                    />
                </div>

                {recipientIsDifferent ? (
                    <div className="if-row m-field-row m-recipient-fields">
                        <div className="if-row-main">
                            <div className="m-recipient-names">
                                <Input
                                    aria-label={t.firstName}
                                    placeholder={t.firstName}
                                    value={recipientFirst}
                                    onChange={(event) => setRecipientFirst(event.target.value)}
                                    onBlur={flushRecipientFirst}
                                    size="large"
                                />
                                <Input
                                    aria-label={t.lastName}
                                    placeholder={t.lastName}
                                    value={recipientLast}
                                    onChange={(event) => setRecipientLast(event.target.value)}
                                    onBlur={flushRecipientLast}
                                    size="large"
                                />
                            </div>
                            <Input
                                aria-label={t.phone}
                                placeholder={t.phone}
                                value={recipientPhone}
                                onChange={(event) => setRecipientPhone(event.target.value)}
                                onBlur={flushRecipientPhone}
                                size="large"
                                status={phoneValid ? '' : 'error'}
                                inputMode="tel"
                            />
                            {!phoneValid && <div className="m-field-error" role="alert">{t.phoneInvalid}</div>}
                        </div>
                    </div>
                ) : (
                    // Same recipient: show the order's own customer as a
                    // read-only contact, the way OrderPanel's DeliverySection
                    // did (customer name + phone), so the delivery contact
                    // stays visible even when it's not typed in here.
                    <div className="m-recipient-contact">
                        <div className="if-row">
                            <span className="if-row-label">{t.client}</span>
                            <span className="if-row-value">{displayCustomerName(order, t) || '—'}</span>
                        </div>
                        <div className="if-row">
                            <span className="if-row-label">{t.phone}</span>
                            <span className="if-row-value">{order.customer_phone || t.notSet}</span>
                        </div>
                    </div>
                )}

                {delivery && (
                    <>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="calendar" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryDate}</span>
                                <DatePicker
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.deliveryDate}
                                    placeholder={t.notSet}
                                    value={dateValue(order.delivery_date)}
                                    // DRF DateField rejects empty strings; send null when cleared.
                                    onChange={(date, dateString) => save({delivery_date: dateString || null})}
                                    disabledDate={(current) => current && current < dayjs().startOf('day')}
                                    suffixIcon={<IosIcon name="chev" size={16} stroke={2.4}/>}
                                />
                            </div>
                        </div>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="clock" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryTime}</span>
                                <div className="m-time-range">
                                    <TimePicker
                                        variant="borderless"
                                        className="if-field-input"
                                        aria-label={t.deliveryTimeFrom}
                                        placeholder={t.deliveryTimeFrom}
                                        format="HH:mm"
                                        needConfirm={false}
                                        suffixIcon={null}
                                        value={timeValue(order.delivery_time_from)}
                                        onChange={(time, timeString) => save({delivery_time_from: timeString || null})}
                                    />
                                    <span aria-hidden="true">–</span>
                                    <TimePicker
                                        variant="borderless"
                                        className="if-field-input"
                                        aria-label={t.deliveryTimeTo}
                                        placeholder={t.deliveryTimeTo}
                                        format="HH:mm"
                                        needConfirm={false}
                                        suffixIcon={null}
                                        value={timeValue(order.delivery_time_to)}
                                        onChange={(time, timeString) => save({delivery_time_to: timeString || null})}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="if-row m-field-row">
                            <span className="if-row-icon"><IosIcon name="tab-orders" size={22}/></span>
                            <div className="if-row-main">
                                <span className="if-field-label">{t.deliveryNotes}</span>
                                <TextArea
                                    variant="borderless"
                                    className="if-field-input"
                                    aria-label={t.deliveryNotes}
                                    placeholder={t.notSet}
                                    autoSize={{minRows: 1, maxRows: 4}}
                                    value={deliveryNotes}
                                    onChange={(event) => setDeliveryNotes(event.target.value)}
                                    onBlur={flushDeliveryNotes}
                                />
                            </div>
                        </div>
                    </>
                )}

                <div className="if-row m-field-row">
                    <span className="if-row-icon"><IosIcon name="tab-orders" size={22}/></span>
                    <div className="if-row-main">
                        <span className="m-field-label-line">
                            <span className="if-field-label">{t.orderNotes}</span>
                            <span className="if-field-hint">{t.optional}</span>
                        </span>
                        <TextArea
                            variant="borderless"
                            className="if-field-input"
                            aria-label={t.orderNotes}
                            placeholder={t.notSet}
                            autoSize={{minRows: 1, maxRows: 4}}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            onBlur={flushNotes}
                        />
                    </div>
                </div>
            </div>

            <h4 className="if-section-header">{t.orderSummary}</h4>
            <div className="if-group">
                <div className="if-row">
                    <span className="if-row-label">{t.client}</span>
                    <span className="if-row-value">{displayCustomerName(order, t) || '—'}</span>
                </div>
                <div className="if-row">
                    <span className="if-row-label">{t.warehouse}</span>
                    <span className="if-row-value">{orderWarehouseNames(order.items).join(', ') || '—'}</span>
                </div>
                <div className="if-row">
                    <span className="if-row-label">{t.quantity}</span>
                    <span className="if-row-value">{t.piecesCount(cartItemCount(order.items))}</span>
                </div>
            </div>
        </>
    );
};

export default DeliveryStep;
