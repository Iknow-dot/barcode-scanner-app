import React, {useState, useEffect, useContext, useCallback} from 'react';
import api, {getUserWarehousesByUserId} from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm, {RenderOption} from "../ModalForm";

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
            {label: data.ip, value: data.ip, desc: `თქვენი IP მისამართი: ${data.ip}`, emoji: '🌐'}
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
            ip_address: object.ip_address ? object.ip_address.split(", ") : [],
            warehouse_ids: userWarehouses.map(wh => wh.id),
            organization_id: object.organization_id
          }}
          name="editUser"
          visible={visible}
          setVisible={setVisible}
          footer={null}
          onFinish={(data) => onFinish(data, object)}
      >
        <Form.Item
            label="მომხმარებელი"
            name="username"
            rules={[
              {
                required: true,
                message: 'გთხოვთ შეიყვანოთ მომხმარებელი!',
              },
            ]}
        >
          <Input/>
        </Form.Item>
        <Form.Item
            label="პაროლი"
            name="password"
            rules={[
              {
                required: false,
                message: 'გთხოვთ შეიყვანოთ პაროლი!',
              },
            ]}
            extra="თუ არ გსურთ პაროლის შეცვლა, დატოვეთ ცარიელი"
        >
          <Input.Password/>
        </Form.Item>

        <Form.Item
            label="როლი"
            name="role_name"
            rules={[
              {
                required: true,
                message: 'გთხოვთ აირჩიოთ როლი!',
              }
            ]}
        >
          <Select>
            <Select.Option value={isAdmin ? 'user' : 'admin'} selected>{isAdmin ? 'user' : 'admin'}</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
            label="IP მისამართი"
            name="ip_address"
            rules={[
              {
                required: false,
                message: 'გთხოვთ შეიყვანოთ IP მისამართი!',
              },
            ]}
        >
          <Select
              mode="tags"
              placeholder="IP მისამართი"
              options={IPOptions}
              optionRender={RenderOption}
              tagRender={(props) => (
                  <Tag color='green'>
                    {props.label}
                  </Tag>
              )}
          />
        </Form.Item>

        {!isAdmin && (
            <Form.Item
                label="ორგანიზაცია"
                name="organization_id"
                rules={[
                  {
                    required: false,
                    message: 'გთხოვთ აირჩიოთ ორგანიზაცია!',
                  }
                ]}
            >
              <Select
                  allowClear
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
                  filterOption={(input, option) =>
                      option?.label.toLowerCase().includes(input.toLowerCase())
                  }
              >
              </Select>
            </Form.Item>
        )}


        {isAdmin && (
            <Form.Item
                label="საწყობი"
                name="warehouse_ids"
                rules={[
                  {
                    required: object.role_name === 'user',
                    message: 'გთხოვთ აირჩიოთ საწყობი!',
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
                  filterOption={(input, option) =>
                      option?.label.toLowerCase().includes(input.toLowerCase())
                  }
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
