import React, {useState, useEffect, useContext, useCallback} from 'react';
import api, {getUserWarehousesByUserId} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm from "../ModalForm";

const EditUser = ({visible, setVisible, onFinish, object}) => {
  const renderOption = useCallback((option) => {
    return (
        <Space>
        <span role="img">
          {option.data.emoji}
        </span>
          {option.data.desc}
        </Space>
    );
  }, []);
  const {authData} = useContext(AuthContext);

  const [IPOptions, setIPOptions] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [userWarehouses, setUserWarehouses] = useState([]);
  const [isAdmin, setIsAdmin] = useState(authData && authData.role === 'admin');

  useEffect(() => {
    const fetchData = async () => {
      if (authData?.role === 'system_admin') {
        const orgRes = await api.get('/organizations');
        setOrganizations(orgRes.data);
      }

      if (authData?.role === 'admin' && object.role_name === 'user') {
        const whRes = await api.get('/warehouses');
        setWarehouses(whRes.data);
        setIsAdmin(true);
      }

      if (authData?.role === 'admin' && object.role_name === 'user' && object.id) {
        setUserWarehouses(await getUserWarehousesByUserId(object.id));
      }
    };

    fetchData();

  }, [authData, object]);

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
          object={{
            username: object.username,
            role_name: object.role_name,
            ip_address: object.ip_address && object.ip_address.split(", "),
            warehouse_ids: userWarehouses.map(wh => wh.id)
          }}
          name="editUser"
          visible={visible}
          setVisible={setVisible}
          footer={null}
          onFinish={(data) => onFinish(data, object)}
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
                required: false,
                message: 'Please input your password!',
              },
            ]}
            extra="Leave empty if you don't want to change the password"
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
                required: false,
                message: 'Please input your IP address!',
              },
            ]}
        >
          <Select
              mode="tags"
              placeholder="IP address"
              options={IPOptions}
              optionRender={(option) => (
                  <Space>
                        <span role="img" aria-label={option.data.label}>
                          {option.data.emoji}
                        </span>
                    {option.data.desc}
                  </Space>
              )}
              tagRender={(props) => (
                  <Tag color='green'>
                    {props.label}
                  </Tag>
              )}
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
              <Select
                  id="organization"
                  name="organization_id"
                  optionRender={renderOption}
                  options={organizations.map(org => ({
                        label: org.name,
                        value: org.id,
                        emoji: '🏢',
                        desc: org.name
                      })
                  )}
              >
              </Select>
            </Form.Item>
        )}

        {isAdmin && (
            <Form.Item
                label="Warehouses"
                name="warehouse_ids"
                rules={[
                  {
                    required: object.role_name === 'user',
                    message: 'Please select Warehouses!',
                  }
                ]}
            >
              <Select
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
                  optionRender={renderOption}
              >
              </Select>
            </Form.Item>
        )}

        <Form.Item label={null}>
          <Button block type="primary" htmlType="submit" variant="solid" color="green">
            შენახვა
          </Button>
        </Form.Item>
      </ModalForm>

  );
};

export default EditUser;
