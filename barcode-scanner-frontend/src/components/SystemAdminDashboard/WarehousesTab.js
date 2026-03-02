import React, {useState, useEffect} from 'react';
import {warehouseService} from '../../api';
import DataTab from "../DataTab";
import AddWarehouseModal from "../Warehouse/AddWarehouseModal";
import EditWarehouseModal from "../Warehouse/EditWarehouseModal";
import useAppNotification from "../../hooks/useAppNotification";
import {useLanguage} from '../../i18n/LanguageContext';

const WarehousesTab = () => {
    const [warehouses, setWarehouses] = useState([]);
    const {notify, contextHolder} = useAppNotification();
    const {t} = useLanguage();

    useEffect(() => {
        const fetchWarehouses = async () => {
            const result = await warehouseService.getWarehouses();
            if (result.success) {
                setWarehouses(result.data);
            }
        };
        fetchWarehouses();
    }, []);

    const handleDelete = async (warehouse) => {
        const result = await warehouseService.deleteWarehouse(warehouse.id);

        if (result.success) {
            setWarehouses(current => current.filter(wh => wh.id !== warehouse.id));
            notify.success(t.warehouseDeleted, t.warehouseDeletedDesc(warehouse.name));
        } else {
            notify.error(t.warehouseDeleteError, result.error);
        }
    };

    const handleEditWarehouse = async (updateWarehouse, originalWarehouse) => {
        const payload = {...originalWarehouse, ...updateWarehouse};
        const result = await warehouseService.updateWarehouse(payload.id, payload);

        if (result.success) {
            setWarehouses(prev => prev.map(wh => wh.id === payload.id ? payload : wh));
            notify.success(t.warehouseEdited, t.warehouseEditedDesc(payload.name));
            return true;
        }

        notify.error(t.warehouseEditError, result.error);
        return false;
    };

    const handleAddWarehouse = async (newWarehouseData) => {
        const result = await warehouseService.createWarehouse(newWarehouseData);

        if (result.success) {
            // Refresh full list from server
            const refreshResult = await warehouseService.getWarehouses();
            if (refreshResult.success) {
                setWarehouses(refreshResult.data);
            }
            notify.success(t.warehouseAdded, t.warehouseAddedDesc(newWarehouseData.name));
            return true;
        }

        notify.error(t.warehouseAddError, result.error);
        return false;
    };

    return (
        <>
            {contextHolder}
            <DataTab
                objects={warehouses}
                columns={[
                    {key: "name", title: t.name, dataIndex: 'name'},
                    {key: "code", title: t.code, dataIndex: 'code'},
                ]}
                AddModal={AddWarehouseModal}
                handleAdd={handleAddWarehouse}
                EditModal={EditWarehouseModal}
                handleEdit={handleEditWarehouse}
                handleDelete={handleDelete}
            />
        </>
    );
};

export default WarehousesTab;
