// IpManagement.js
import React, { useState } from 'react';
import { addIpToUser, deleteIp } from '../../api';

const IpManagement = ({ userId }) => {
    const [ip, setIp] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAddIp = async () => {
        setLoading(true); // Set loading to true while processing the request
        try {
            const response = await addIpToUser(userId, ip);
            alert('IP added successfully: ' + response.data.message);
            setIp('');  // Clear input after successful addition
        } catch (error) {
            alert('Failed to add IP: ' + (error.response ? error.response.data.description : 'Network error'));
        } finally {
            setLoading(false); // Reset loading state regardless of the outcome
        }
    };

    const handleDeleteIp = async (ipId) => {
        setLoading(true);
        try {
            await deleteIp(ipId);
            alert('IP deleted successfully');
        } catch (error) {
            alert('Failed to delete IP: ' + (error.response ? error.response.data.description : 'Network error'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <input
                value={ip}
                onChange={e => setIp(e.target.value)}
                placeholder="Enter IP Address"
                disabled={loading}
            />
            <button onClick={handleAddIp} disabled={loading || !ip}>
                Add IP
            </button>
        </div>
    );
};

export default IpManagement;
