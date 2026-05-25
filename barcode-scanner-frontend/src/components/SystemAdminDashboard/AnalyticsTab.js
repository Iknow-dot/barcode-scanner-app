import React, {useState, useEffect, useCallback, useContext} from 'react';
import {Table, DatePicker, Select, Flex, Typography, Button} from 'antd';
import {SearchOutlined} from '@ant-design/icons';
import dayjs from 'dayjs';
import {analyticsService, organizationService, userRoles} from '../../api';
import AuthContext from '../Auth/AuthContext';
import useAppNotification from '../../hooks/useAppNotification';
import {useLanguage} from '../../i18n/LanguageContext';
import formatConversionRate from '../../utils/formatConversionRate';

const {Text} = Typography;
const {RangePicker} = DatePicker;

const AnalyticsTab = () => {
    const {t} = useLanguage();
    const {notify, contextHolder} = useAppNotification();
    const {authData} = useContext(AuthContext);
    const isInternalAdmin = authData?.role === userRoles.internal_admin;

    const [rows, setRows] = useState([]);
    const [totals, setTotals] = useState(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState([dayjs().startOf('month'), dayjs()]);
    const [orgs, setOrgs] = useState([]);
    const [orgId, setOrgId] = useState(null);

    const fetchAnalytics = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (range && range[0]) params.date_from = range[0].format('YYYY-MM-DD');
            if (range && range[1]) params.date_to = range[1].format('YYYY-MM-DD');
            if (isInternalAdmin && orgId) params.organization = orgId;
            const result = await analyticsService.getOrderAnalytics(params);
            if (result.success) {
                setRows(result.data.consultants || []);
                setTotals(result.data.totals || null);
            } else {
                notify.error(t.error, t.dataFetchError);
            }
        } finally {
            setLoading(false);
        }
    }, [range, orgId, isInternalAdmin, notify, t]);

    useEffect(() => {
        fetchAnalytics();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!isInternalAdmin) return;
        organizationService.getOrganizations().then((result) => {
            if (result.success) {
                const data = result.data;
                setOrgs(Array.isArray(data) ? data : data.results || []);
            }
        });
    }, [isInternalAdmin]);

    const columns = [
        {title: t.consultant, dataIndex: 'username', key: 'username'},
        {
            title: t.ordersCreated, dataIndex: 'orders_created', key: 'orders_created',
            sorter: (a, b) => a.orders_created - b.orders_created, defaultSortOrder: 'descend',
        },
        {title: t.ordersConfirmed, dataIndex: 'orders_confirmed', key: 'orders_confirmed'},
        {
            title: t.conversionRate, key: 'conversion_rate',
            render: (_, r) => formatConversionRate(r.conversion_rate),
        },
    ];

    return (
        <>
            {contextHolder}
            <Flex gap={8} wrap="wrap" align="center" style={{marginBottom: 16}}>
                <RangePicker value={range} onChange={setRange} allowClear={false}/>
                {isInternalAdmin && (
                    <Select
                        allowClear
                        placeholder={t.organizations}
                        style={{minWidth: 200}}
                        value={orgId}
                        onChange={setOrgId}
                        options={orgs.map((o) => ({value: o.id, label: o.name}))}
                    />
                )}
                <Button type="primary" icon={<SearchOutlined/>} onClick={fetchAnalytics}>
                    {t.search}
                </Button>
            </Flex>
            <Table
                rowKey="user_id"
                columns={columns}
                dataSource={rows}
                loading={loading}
                pagination={false}
                summary={() => totals && (
                    <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Text strong>{t.analyticsTotals}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={1}><Text strong>{totals.orders_created}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={2}><Text strong>{totals.orders_confirmed}</Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={3}><Text strong>{formatConversionRate(totals.conversion_rate)}</Text></Table.Summary.Cell>
                    </Table.Summary.Row>
                )}
            />
        </>
    );
};

export default AnalyticsTab;
