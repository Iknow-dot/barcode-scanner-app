import React, {useState, useEffect, useContext} from 'react';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Select, Space, Tag} from "antd";
import ModalForm, {RenderOption, TagSelect} from "../ModalForm";


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
          visible={visible}
          setVisible={setVisible}
          onFinish={onFinish}
          title="მომხმარებლის დამატება"
          name="addUser"
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
                required: true,
                message: 'გთხოვთ შეიყვანოთ პაროლი!',
              },
            ]}
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
            initialValue={isAdmin ? 'user' : 'admin'}
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
              options={IPOptions}
              mode="tags"
              placeholder="IP მისამართი"
              name="ip_address"
              label="IP address"
              optionRender={(option) => (
                  <Space>
                    <span role="img">
                      {option.data?.emoji}
                    </span>
                    {option.data?.desc || option.data?.label}
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
                label="ორგანიზაცია"
                name="organization_id"
                rules={[
                  {
                    required: true,
                    message: 'გთხოვთ აირჩიოთ ორგანიზაცია!',
                  }
                ]}
            >
              <Select
                  options={organizations.map(org => ({
                        label: org.name,
                        value: org.id,
                        emoji: '🏢',
                        desc: org.name
                      })
                  )}
                  placeholder="აირჩიეთ ორგანიზაცია"
                  name="organization_id"
                  label="Organization"
                  optionRender={RenderOption}
                  tagRender={(props) => (
                      <Tag color='green'>
                        {props.label}
                      </Tag>
                  )}
                  filterOption={(input, option) =>
                      option?.label.toLowerCase().includes(input.toLowerCase())
                  }
              />
            </Form.Item>
        )}

        {isAdmin && (
            <Form.Item
                label="საწყობები"
                name="warehouse_ids"
                rules={[
                  {
                    required: true,
                    message: 'გთხოვთ აირჩიოთ საწყობები!',
                  }
                ]}
            >
              <Select
                  name="warehouse_ids"
                  mode="multiple"
                  allowClear
                  placeholder="აირჩიეთ საწყობები"
                  rules={[
                    {
                      required: true,
                      message: 'გთხოვთ აირჩიოთ საწყობი!',
                    }
                  ]}
                  optionRender={RenderOption}
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
                  filterOption={(input, option) =>
                      option?.label.toLowerCase().includes(input.toLowerCase())
                  }
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
