import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
    Button,
    Drawer,
    Flex,
    Form,
    InputNumber,
    Select,
    Tag,
    Typography,
} from 'antd';
import {ShoppingCartOutlined} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';

const {Text} = Typography;

const pickDefaultWarehouse = (balances, initial) => {
    if (!Array.isArray(balances) || balances.length === 0) return null;
    if (initial) {
        const match = balances.find((b) => b.warehouse === initial);
        if (match) return match.warehouse;
    }
    if (balances.length === 1) return balances[0].warehouse;
    const sorted = [...balances].sort(
        (a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0),
    );
    return sorted[0].warehouse;
};

const AddToCartSheet = ({
    open,
    productInfo,
    balances,
    initialWarehouseCode,
    unit,
    onConfirm,
    onClose,
    confirming,
}) => {
    const {t} = useLanguage();
    const [quantity, setQuantity] = useState(1);
    const [warehouseCode, setWarehouseCode] = useState(null);
    const inputRef = useRef(null);

    const sellableBalances = useMemo(
        () => (balances || []).filter((b) => (Number(b.quantity) || 0) > 0),
        [balances],
    );

    useEffect(() => {
        if (!open) return;
        setQuantity(1);
        setWarehouseCode(pickDefaultWarehouse(sellableBalances, initialWarehouseCode));
        // Defer focus so the Drawer animation doesn't steal it.
        const id = window.setTimeout(() => {
            inputRef.current?.focus({cursor: 'all'});
        }, 120);
        return () => window.clearTimeout(id);
    }, [open, sellableBalances, initialWarehouseCode]);

    const selected = sellableBalances.find((b) => b.warehouse === warehouseCode) || null;
    const stock = Number(selected?.quantity) || 0;
    const unitLabel = unit
        ? (t.unitOptions?.find((opt) => opt.value === unit)?.label || unit)
        : null;

    const exceeds = quantity > stock;
    const invalid = !selected || !quantity || quantity < 1 || exceeds;

    const handleConfirm = () => {
        if (invalid || !selected) return;
        onConfirm({
            quantity,
            warehouse_code: selected.warehouse,
            warehouse_name: selected.warehouse_name,
            price: selected.price,
        });
    };

    return (
        <Drawer
            placement="bottom"
            height="auto"
            open={open}
            onClose={onClose}
            destroyOnHidden
            closable
            title={
                <Flex align="center" gap={8}>
                    <ShoppingCartOutlined/>
                    <span>{t.addToCart}</span>
                </Flex>
            }
            styles={{
                body: {paddingTop: 12, paddingBottom: 16},
                header: {padding: '12px 16px'},
            }}
            rootClassName="m-add-to-cart-drawer"
        >
            <Form layout="vertical" onFinish={handleConfirm}>
                <div style={{marginBottom: 12}}>
                    <Text strong style={{fontSize: 15, display: 'block'}}>
                        {productInfo?.sku_name || ''}
                    </Text>
                    {productInfo?.article && (
                        <Text type="secondary" style={{fontSize: 12}}>
                            {productInfo.article}
                        </Text>
                    )}
                </div>

                {sellableBalances.length > 1 ? (
                    <Form.Item label={t.warehouse} style={{marginBottom: 12}}>
                        <Select
                            value={warehouseCode}
                            onChange={setWarehouseCode}
                            options={sellableBalances.map((b) => ({
                                value: b.warehouse,
                                label: `${b.warehouse_name} · ${Number(b.quantity) || 0}`,
                            }))}
                        />
                    </Form.Item>
                ) : selected ? (
                    <div style={{marginBottom: 12}}>
                        <Tag color="blue">{selected.warehouse_name}</Tag>
                    </div>
                ) : null}

                <Flex justify="space-between" align="center" style={{marginBottom: 4}}>
                    <Text strong>{t.quantity}</Text>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {t.stockRemaining}: {stock}
                    </Text>
                </Flex>
                <Form.Item
                    validateStatus={exceeds ? 'error' : ''}
                    help={exceeds ? t.exceedsStock(stock) : null}
                    style={{marginBottom: 12}}
                >
                    <InputNumber
                        ref={inputRef}
                        min={1}
                        max={stock || 1}
                        step={1}
                        value={quantity}
                        onChange={(v) => setQuantity(Number(v) || 1)}
                        onPressEnter={handleConfirm}
                        addonAfter={unitLabel || undefined}
                        style={{width: '100%'}}
                        size="large"
                        controls
                    />
                </Form.Item>

                {selected && (
                    <Flex justify="space-between" style={{marginBottom: 16}}>
                        <Text type="secondary">{t.price}</Text>
                        <Text>{selected.price} ₾</Text>
                    </Flex>
                )}

                <Flex gap={8}>
                    <Button block size="large" onClick={onClose} disabled={confirming}>
                        {t.cancel}
                    </Button>
                    <Button
                        block
                        size="large"
                        type="primary"
                        htmlType="submit"
                        disabled={invalid}
                        loading={confirming}
                    >
                        {t.save}
                    </Button>
                </Flex>
            </Form>
        </Drawer>
    );
};

export default AddToCartSheet;
