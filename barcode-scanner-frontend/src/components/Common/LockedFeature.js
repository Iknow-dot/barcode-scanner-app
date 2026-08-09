import React from 'react';
import {Button, Card, Modal, Typography} from 'antd';
import {LockOutlined, UnlockOutlined} from '@ant-design/icons';

const {Title, Paragraph} = Typography;

/**
 * Teaser view for an org-level feature that is disabled: renders a blurred,
 * non-interactive demo of the page with an overlay explaining the feature
 * and how to unlock it.
 *
 * The blur is presentation only — the backend endpoints stay gated (403),
 * so children must be DEMO content, never real data fetched past the gate.
 *
 * @param {string} title - Overlay heading (feature name + locked state).
 * @param {string} description - What the feature offers.
 * @param {string} unlockLabel - CTA button label.
 * @param {string} unlockHint - Modal text explaining how to get it enabled.
 * @param {React.ReactNode} children - The blurred demo preview.
 */
const LockedFeature = ({title, description, unlockLabel, unlockHint, children}) => {
    const [modal, contextHolder] = Modal.useModal();

    const showUnlockHint = () => {
        modal.info({
            title,
            content: unlockHint,
            icon: <UnlockOutlined/>,
            okText: 'OK',
        });
    };

    return (
        <div style={{position: 'relative', minHeight: 320}}>
            {contextHolder}
            <div
                aria-hidden="true"
                style={{
                    filter: 'blur(5px)',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    opacity: 0.7,
                }}
            >
                {children}
            </div>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2,
                }}
            >
                <Card style={{maxWidth: 420, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.12)'}}>
                    <LockOutlined style={{fontSize: 40, color: '#1677ff', marginBottom: 12}}/>
                    <Title level={4} style={{marginTop: 0}}>{title}</Title>
                    <Paragraph type="secondary">{description}</Paragraph>
                    <Button type="primary" size="large" icon={<UnlockOutlined/>} onClick={showUnlockHint}>
                        {unlockLabel}
                    </Button>
                </Card>
            </div>
        </div>
    );
};

export default LockedFeature;
