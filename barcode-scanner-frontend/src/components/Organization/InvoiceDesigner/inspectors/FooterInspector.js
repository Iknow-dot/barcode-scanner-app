import React from 'react';
import BrandingFields from './BrandingFields';

const FOOTER_FIELDS = ['invoice_footer_text'];

const FooterInspector = ({branding, onBrandingChange}) => (
    <BrandingFields branding={branding} onBrandingChange={onBrandingChange} fields={FOOTER_FIELDS} />
);

export default FooterInspector;
