import React from 'react';
import {Card, Empty, Flex, Tag, Typography} from 'antd';
import {
    BarcodeOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    ShoppingOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import {useLanguage} from '../../i18n/LanguageContext';
import formatRelativeTime from '../../utils/formatRelativeTime';

const {Text} = Typography;

const greetingForHour = (hour, t) => {
    if (hour < 12) return t.greetingMorning;
    if (hour < 18) return t.greetingAfternoon;
    return t.greetingEvening;
};

const DailySnapshot = ({username, scansSummary, recentScans, ordersSummary, onResearch}) => {
    const {t} = useLanguage();
    const greeting = greetingForHour(new Date().getHours(), t);
    const displayName = username || '';

    return (
        <div className="m-daily-snapshot">
            <div className="m-greeting">
                <div className="m-greeting-text">
                    {displayName ? `${greeting}, ${displayName}` : greeting}
                </div>
                <div className="m-greeting-sub">{t.dashboardSubtitle}</div>
            </div>

            <div className="m-kpi-row">
                <div className="m-kpi-card blue">
                    <div className="m-kpi-label">
                        <BarcodeOutlined/> {t.scansToday}
                    </div>
                    <div className="m-kpi-value">{scansSummary.count}</div>
                    {scansSummary.count > 0 && (
                        <div className="m-kpi-meta">
                            {t.foundCount(scansSummary.foundCount)} · {t.notFoundCount(scansSummary.notFoundCount)}
                        </div>
                    )}
                </div>
                <div className="m-kpi-card green">
                    <div className="m-kpi-label">
                        <ShoppingOutlined/> {t.ordersToday}
                    </div>
                    <div className="m-kpi-value">{ordersSummary.count}</div>
                    {ordersSummary.count > 0 && (
                        <div className="m-kpi-meta">
                            {t.currencyTotal(ordersSummary.total.toFixed(2))}
                        </div>
                    )}
                </div>
            </div>

            <Flex align="center" gap={6} className="m-warehouse-section-header">
                <ClockCircleOutlined style={{color: '#1677ff'}}/>
                <Text strong style={{fontSize: 13}}>{t.recentScans}</Text>
                <Tag style={{marginLeft: 4}}>{t.today}</Tag>
            </Flex>

            <Card className="m-recent-scans" bordered={false}>
                {recentScans.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <Text type="secondary" style={{fontSize: 13}}>{t.noScansToday}</Text>
                        }
                        style={{margin: '12px 0'}}
                    />
                ) : (
                    recentScans.map((scan) => (
                        <div
                            key={scan.scanned_at}
                            className="m-recent-row"
                            onClick={() => onResearch && onResearch(scan)}
                        >
                            <div className={`m-recent-thumb ${scan.found ? '' : 'm-recent-thumb-notfound'}`}>
                                {scan.found ? <BarcodeOutlined/> : <WarningOutlined/>}
                            </div>
                            <div className="m-recent-info">
                                <div className="m-recent-name">{scan.found ? scan.sku_name : scan.search}</div>
                                <div className="m-recent-meta">
                                    {scan.found
                                        ? `${formatRelativeTime(scan.scanned_at, t)} · ${scan.price} ₾ · ${t.inStock(scan.total_qty)}`
                                        : `${formatRelativeTime(scan.scanned_at, t)} · ${t.notFound}`}
                                </div>
                            </div>
                            {scan.found
                                ? <Tag color="green"><CheckOutlined/></Tag>
                                : <Tag>—</Tag>}
                        </div>
                    ))
                )}
            </Card>
        </div>
    );
};

export default DailySnapshot;
