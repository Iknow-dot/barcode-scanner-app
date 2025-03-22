import React, {useState, useEffect, useContext, useCallback} from 'react';
import './AddUser.css';
import api from '../../api';
import AuthContext from '../Auth/AuthContext';
import {Button, Form, Input, Modal, Select, Space, Tag} from "antd";

const AddUser = ({closeModal, isModalOpen}) => {
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

  const onFinish = async (userData) => {

    if (authData?.role === 'admin') {
      userData.organization_id = authData.organization_id; // Admin's organization
      userData.role_name = 'user'; // Admin adds users with the role 'user'
    }
    try {
      userData["ip_address"] = userData["ip_address"].join(", ");
      console.log(userData);
      // Make the API call to create the user
      const response = await api.post('/users', userData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.status === 201) {
        alert('მომხმარებელი დაემატა წარმატებით!');
        closeModal();
      }
    } catch (error) {
      console.error('შეცდომა მომხმარებლის შექმნისას:', error.response?.data?.error || error.message);
      alert('მომხმარებლის შექმნა ვერ მოხერხდა: ' + (error.response?.data?.error || error.message));
    }
  };

  const onFinishFailed = (errorInfo) => {
    console.log('Failed:', errorInfo);
  }

  return (
      <Modal open={isModalOpen} title="მომხმარებლის დამატება" onCancel={closeModal} footer={null}>
        <Form
            name="addUserForm"
            layout="vertical"
            style={{
              maxWidth: "none",
              width: "100%"
            }}
            initialValues={{
              remember: false,
            }}
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            autoComplete="off"
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
              initialValue={IPOptions}
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
                      required: true,
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
              დამატება
            </Button>
          </Form.Item>
        </Form>
      </Modal>
  );
};

export default AddUser;
