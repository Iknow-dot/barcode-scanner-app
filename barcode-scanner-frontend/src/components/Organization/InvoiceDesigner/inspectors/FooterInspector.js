import React from 'react';
import BrandingFields from './BrandingFields';

const FooterInspector = ({branding, onBrandingChange}) => (
    <BrandingFields branding={branding} onBrandingChange={onBrandingChange} />
);

export default FooterInspector;
