import { FormSubmitEvent } from '@ng-forge/dynamic-forms';
import {
  ButtonField,
  CheckboxField,
  DatepickerField,
  InputField,
  InputProps,
  SelectField,
} from '@ng-forge/dynamic-forms/integration';

export type SpartanTextProps = InputProps & {
  hint?: string;
};

export type SpartanTextField = InputField<SpartanTextProps>;

export type SpartanDateTimeField = Omit<
  DatepickerField<{ hint?: string }>,
  'type'
> & {
  type: 'datetime';
};

export type SpartanSelectField = SelectField<
  string,
  Readonly<{ hint?: string }>
>;

export type SpartanCheckboxField = CheckboxField<Readonly<{ hint?: string }>>;

type SpartanButtonField = ButtonField<
  Readonly<{ variant?: 'default' | 'secondary' }>,
  FormSubmitEvent
>;

export type SpartanSubmitField = Omit<
  SpartanButtonField,
  'event' | 'eventArgs' | 'type'
> & {
  type: 'submit';
};

declare module '@ng-forge/dynamic-forms' {
  interface FieldRegistryLeaves {
    input: SpartanTextField;
    datetime: SpartanDateTimeField;
    select: SpartanSelectField;
    checkbox: SpartanCheckboxField;
    submit: SpartanSubmitField;
  }
}
