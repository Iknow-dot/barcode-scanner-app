from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import User, UserRole

bp = Blueprint('user', __name__, url_prefix='/users')

@bp.route('', methods=['POST'])
@jwt_required()  # Add JWT authentication to this route
def create_user():
    current_user = get_jwt_identity()  # Get the identity of the current user
    data = request.json
    username = data.get('username')
    password = data.get('password')
    role_id = data.get('role_id')
    organization_id = data.get('organization_id')
    warehouse_id = data.get('warehouse_id')
    ip_address = data.get('ip_address')

    if not username or not password or not role_id:
        return jsonify({'error': 'Missing required fields'}), 400
    
    user = User(
        username=username,
        role_id=role_id,
        organization_id=organization_id,
        warehouse_id=warehouse_id,
        ip_address=ip_address
    )
    user.set_password(password)
    
    db.session.add(user)
    db.session.commit()
    
    return jsonify({'message': 'User created'}), 201

@bp.route('<uuid:user_id>', methods=['GET'])
@jwt_required()  # Add JWT authentication to this route
def get_user(user_id):
    current_user = get_jwt_identity()  # Get the identity of the current user
    user = User.query.get_or_404(user_id)
    return jsonify({
        'id': str(user.id),
        'username': user.username,
        'role_id': str(user.role_id),
        'organization_id': str(user.organization_id),
        'warehouse_id': str(user.warehouse_id),
        'ip_address': user.ip_address
    })

@bp.route('<uuid:user_id>', methods=['PUT'])
@jwt_required()  # Add JWT authentication to this route
def update_user(user_id):
    current_user = get_jwt_identity()  # Get the identity of the current user
    user = User.query.get_or_404(user_id)
    data = request.json
    user.username = data.get('username', user.username)
    if 'password' in data:
        user.set_password(data['password'])
    user.role_id = data.get('role_id', user.role_id)
    user.organization_id = data.get('organization_id', user.organization_id)
    user.warehouse_id = data.get('warehouse_id', user.warehouse_id)
    user.ip_address = data.get('ip_address', user.ip_address)
    
    db.session.commit()
    
    return jsonify({'message': 'User updated'})

@bp.route('<uuid:user_id>', methods=['DELETE'])
@jwt_required()  # Add JWT authentication to this route
def delete_user(user_id):
    current_user = get_jwt_identity()  # Get the identity of the current user
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    
    return jsonify({'message': 'User deleted'})
