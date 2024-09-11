from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import User, UserRole, Organization, Warehouse
from sqlalchemy.exc import IntegrityError

bp = Blueprint('user', __name__, url_prefix='/users')

@bp.route('', methods=['POST'])
@jwt_required()
def create_user():
    current_user = get_jwt_identity()
    # Check if current user is authorized (e.g., admin or system admin)
    if not User.query.get(current_user).is_admin():
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.json
    username = data.get('username')
    password = data.get('password')
    role_id = data.get('role_id')
    organization_id = data.get('organization_id')
    warehouse_id = data.get('warehouse_id')
    ip_address = data.get('ip_address')

    # Validate required fields
    if not username or not password or not role_id:
        return jsonify({'error': 'Missing required fields'}), 400

    # Check if the role exists
    role = UserRole.query.get(role_id)
    if not role:
        return jsonify({'error': 'Invalid role ID'}), 400

    # Check if organization and warehouse exist (if provided)
    if organization_id and not Organization.query.get(organization_id):
        return jsonify({'error': 'Invalid organization ID'}), 400
    if warehouse_id and not Warehouse.query.get(warehouse_id):
        return jsonify({'error': 'Invalid warehouse ID'}), 400

    user = User(
        username=username,
        role_id=role_id,
        organization_id=organization_id,
        warehouse_id=warehouse_id,
        ip_address=ip_address
    )
    user.set_password(password)

    try:
        db.session.add(user)
        db.session.commit()
        return jsonify({'message': 'User created', 'user': user.to_dict()}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error creating user. Please try again.'}), 500

@bp.route('<uuid:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    current_user = get_jwt_identity()
    user = User.query.get_or_404(user_id)
    
    # Check if current user is authorized to view this user
    if not User.query.get(current_user).is_admin() and current_user != user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    return jsonify(user.to_dict())

@bp.route('<uuid:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    current_user = get_jwt_identity()
    user = User.query.get_or_404(user_id)

    # Check if current user is authorized to update this user
    if not User.query.get(current_user).is_admin() and current_user != user_id:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.json
    user.username = data.get('username', user.username)
    if 'password' in data:
        user.set_password(data['password'])
    user.role_id = data.get('role_id', user.role_id)
    user.organization_id = data.get('organization_id', user.organization_id)
    user.warehouse_id = data.get('warehouse_id', user.warehouse_id)
    user.ip_address = data.get('ip_address', user.ip_address)

    try:
        db.session.commit()
        return jsonify({'message': 'User updated', 'user': user.to_dict()})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error updating user. Please try again.'}), 500

@bp.route('<uuid:user_id>', methods=['DELETE'])
@jwt_required()
def delete_user(user_id):
    current_user = get_jwt_identity()
    user = User.query.get_or_404(user_id)

    # Check if current user is authorized to delete this user
    if not User.query.get(current_user).is_admin():
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        db.session.delete(user)
        db.session.commit()
        return jsonify({'message': 'User deleted'})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error deleting user. Please try again.'}), 500
