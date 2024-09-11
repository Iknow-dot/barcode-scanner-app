from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_jwt_extended import jwt_required
from app import db
from app.models import UserRole
from sqlalchemy.exc import IntegrityError

bp = Blueprint('user_roles', __name__)

@bp.route('/user_roles')
@jwt_required()  # Add JWT authentication to this route
def list_user_roles():
    roles = UserRole.query.all()
    return render_template('user_roles.html', roles=roles)

@bp.route('/user_roles/create', methods=['GET', 'POST'])
@jwt_required()  # Add JWT authentication to this route
def create_user_role():
    if request.method == 'POST':
        role_name = request.form.get('role_name')

        # Validation for empty role name
        if not role_name:
            flash('Role name cannot be empty.', 'error')
            return redirect(url_for('user_roles.create_user_role'))

        # Check for existing role with the same name
        existing_role = UserRole.query.filter_by(role_name=role_name).first()
        if existing_role:
            flash('Role name already exists.', 'error')
            return redirect(url_for('user_roles.create_user_role'))

        try:
            new_role = UserRole(role_name=role_name)
            db.session.add(new_role)
            db.session.commit()
            flash('User role created successfully!', 'success')
        except IntegrityError:
            db.session.rollback()
            flash('Error creating role. Please try again.', 'error')

        return redirect(url_for('user_roles.list_user_roles'))

    return render_template('create_user_role.html')

@bp.route('/user_roles/delete/<uuid:id>', methods=['POST'])
@jwt_required()  # Add JWT authentication to this route
def delete_user_role(id):
    role = UserRole.query.get_or_404(id)

    # Check if any users are assigned to this role before deleting
    if role.users:
        flash('Cannot delete role, as it is assigned to one or more users.', 'error')
        return redirect(url_for('user_roles.list_user_roles'))

    try:
        db.session.delete(role)
        db.session.commit()
        flash('User role deleted successfully!', 'success')
    except IntegrityError:
        db.session.rollback()
        flash('Error deleting role. Please try again.', 'error')

    return redirect(url_for('user_roles.list_user_roles'))
