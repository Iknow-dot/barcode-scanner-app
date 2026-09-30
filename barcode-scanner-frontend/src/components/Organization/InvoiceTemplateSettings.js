import React, {Suspense} from 'react';
import {Spin} from 'antd';

// The designer pulls in TipTap; keep it out of the dashboard's main bundle.
const InvoiceDesigner = React.lazy(() => import('./InvoiceDesigner/InvoiceDesigner'));

/** Company admin's invoice settings: the block-based invoice designer. */
const InvoiceTemplateSettings = () => (
    <Suspense fallback={<Spin />}>
        <InvoiceDesigner />
    </Suspense>
);

export default InvoiceTemplateSettings;
