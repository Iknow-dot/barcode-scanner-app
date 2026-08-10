import React from 'react';
import {Drawer, Menu} from 'antd';

/**
 * Collapsible sidebar for the admin pages on small screens — replaces the
 * horizontal header menu. Opens from the left via the header's hamburger
 * button and closes itself as soon as a destination is chosen (each item's
 * own onClick still fires through the Menu).
 */
const AdminNavDrawer = ({open, onClose, items, isDarkMode, selectedKeys, title}) => (
    <Drawer
        placement="left"
        open={open}
        onClose={onClose}
        width={264}
        title={title}
        destroyOnHidden
        styles={{body: {padding: 0}}}
    >
        <Menu
            theme={isDarkMode ? 'dark' : 'light'}
            mode="inline"
            items={items}
            selectedKeys={selectedKeys}
            onClick={onClose}
            style={{borderRight: 'none', fontWeight: 500}}
        />
    </Drawer>
);

export default AdminNavDrawer;
