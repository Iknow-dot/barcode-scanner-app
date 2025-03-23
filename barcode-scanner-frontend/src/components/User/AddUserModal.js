import React, {useState, useEffect, useContext, useCallback} from 'react';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Modal, Select, Space, Tag} from "antd";
import ModalForm, {TagSelect} from "../ModalForm";



const AddUserModal = ({visible, setVisible, onFinish}) => {
  const {authData} = useContext(AuthContext);
  const [IPOptions, setIPOptions] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [isAdmin, setIsAdmin] = useState(authData?.role === 'admin');

  // Fetch organizations and warehouses if applicable
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (authData?.role === 'system_admin') {
          const orgRes = await api.get('/organizations');
          setOrganizations(orgRes.data);
        } else if (authData?.role === 'admin') {
          const whRes = await api.get('/warehouses');
          setWarehouses(whRes.data);
          setIsAdmin(true);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, [authData]);

  useEffect(() => {
    const fetchIp = async () => {
      try {
        const {data} = await api.get('/auth/ip');
        setIPOptions((prevState) => {
          return [
            ...prevState.filter((option) => option.value !== data.ip),
            {label: data.ip, value: data.ip, desc: `Your current IP address: ${data.ip}`, emoji: '🌐'}
          ];
        });
      } catch (error) {
        console.error('Error fetching IP:', error);
      }
    }
    fetchIp();
  }, []);


  return (
      <ModalForm
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title="Add User"
          name="addUser"
      >
        <Form.Item
            label="Username"
            name="username"
            rules={[
              {
                required: true,
                message: 'Please input your username!',
              },
            ]}
        >
          <Input/>
        </Form.Item>
        <Form.Item
            label="Password"
            name="password"
            rules={[
              {
                required: true,
                message: 'Please input your password!',
              },
            ]}
        >
          <Input.Password/>
        </Form.Item>

        <Form.Item
            label="Role"
            name="role_name"
            rules={[
              {
                required: true,
                message: 'Please select Role!',
              }
            ]}
            initialValue={isAdmin ? 'user' : 'admin'}
        >
          <Select>
            <Select.Option value={isAdmin ? 'user' : 'admin'} selected>{isAdmin ? 'user' : 'admin'}</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
            label="IP Address"
            name="ip_address"
            rules={[
              {
                required: true,
                message: 'Please input your IP address!',
              },
            ]}
        >
          <TagSelect
              options={IPOptions}
              mode="tags"
              placeholder="IP address"
              name="ip_address"
              label="IP address"
              rules={[
                {
                  required: true,
                  message: 'Please input your IP address!',
                },
              ]}
          />
        </Form.Item>

        {!isAdmin && (
            <Form.Item
                label="Organization"
                name="organization_id"
                rules={[
                  {
                    required: true,
                    message: 'Please select Organization!',
                  }
                ]}
            >
              <TagSelect
                  options={organizations.map(org => ({
                        label: org.name,
                        value: org.id,
                        emoji: '🏢',
                        desc: org.name
                      })
                  )}
                  mode="single"
                  placeholder="Organization"
                  name="organization_id"
                  label="Organization"
                  rules={[
                    {
                      required: true,
                      message: 'Please select Organization!',
                    }
                  ]}
              />
            </Form.Item>
        )}

        {isAdmin && (
            <Form.Item
                label="Warehouses"
                name="warehouse_ids"
                rules={[
                  {
                    required: true,
                    message: 'Please select Warehouses!',
                  }
                ]}
            >
              <TagSelect
                  mode="multiple"
                  tagRender={(props) => (
                      <Tag color='green'>
                        {props.label}
                      </Tag>
                  )}
                  options={warehouses.map(wh => ({
                        label: wh.name,
                        value: wh.id,
                        emoji: '🏢',
                        desc: wh.name
                      })
                  )}
              />
            </Form.Item>
        )}

        <Form.Item label={null}>
          <Button block type="primary" htmlType="submit" variant="solid" color="green">
            დამატება
          </Button>
        </Form.Item>
      </ModalForm>
  );
};

export default AddUserModal;
