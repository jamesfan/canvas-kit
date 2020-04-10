import * as React from 'react';
import {ErrorType} from '@workday/canvas-kit-react-common';
import {menuFadeDuration} from './SelectMenu';
import SelectBase, {CoreSelectBaseProps, Option, NormalizedOption} from './SelectBase';
import uuid from 'uuid/v4';

export interface SelectProps extends CoreSelectBaseProps {
  /**
   * The options of the Select. `options` may be an array of objects or an array of strings.
   *
   * If `options` is an array of objects, each object must adhere to the `Option` interface:
   *
   * * `value: string` (required, analagous to the `value` attribute of an `<option>`)
   * * `disabled: boolean` (optional)
   * * `id: string` (optional, a random `id` will be assigned to the object if one isn't provided)
   * * `label: string` (optional, analagous to the text content of an `<option>`)
   *
   * If `label` is omitted, the `value` will be used to render the option.
   *
   * Additionally, each option may contain any number of other key/value pairs. These keys will be passed through to the `option` parameter of the `renderOption` prop and may be used to customize how each option is rendered.
   */
  options: (Option | string)[];
}

interface SelectState {
  focusedOptionIndex: number;
  isMenuHidden: boolean;
  isMenuHiding: boolean;
  label: string;
  selectedOptionIndex: number;
}

export default class Select extends React.Component<SelectProps, SelectState> {
  static ErrorType = ErrorType;

  state: Readonly<SelectState> = {
    focusedOptionIndex: 0,
    isMenuHidden: true,
    isMenuHiding: false,
    label: '',
    selectedOptionIndex: 0,
  };

  private buttonRef = React.createRef<HTMLButtonElement>();
  private inputRef = React.createRef<HTMLInputElement>();
  private menuRef = React.createRef<HTMLUListElement>();

  private removeMenuTimer: ReturnType<typeof setTimeout>;

  // For type-ahead functionality
  private keysSoFar = '';
  private clearKeysSoFarTimeout = 500;
  private clearKeysSoFarTimer: ReturnType<typeof setTimeout>;

  private normalizedOptions: NormalizedOption[];

  // Store normalized options since the options prop can take on multiple
  // forms: an array of strings or an array of objects (sometimes with
  // arbitrary keys)
  private setNormalizedOptions = (): void => {
    const {options} = this.props;

    this.normalizedOptions = options.map(option => {
      let disabled, id, label, value;

      if (typeof option === 'string') {
        disabled = false;
        id = uuid();
        value = option;
        label = option;
      } else {
        disabled = !!option.disabled;
        id = option.id || uuid();
        value = option.value;
        label = option.label || option.value;
      }

      // Merge user-provided option with normalized option fields
      return {
        ...(typeof option === 'string' ? {} : option),
        disabled,
        id,
        label,
        value,
      };
    });
  };

  private getIndexByValue = (value: string | undefined): number => {
    if (value === undefined) {
      return -1;
    }

    for (let i = 0; i < this.normalizedOptions.length; i++) {
      if (this.normalizedOptions[i].value === value) {
        return i;
      }
    }

    return -1;
  };

  private getIndexByStartString = (
    startIndex: number,
    startString: string,
    endIndex: number = this.normalizedOptions.length,
    ignoreDisabled: boolean = true
  ): number => {
    for (let i = startIndex; i < endIndex; i++) {
      const label = this.normalizedOptions[i].label.toLowerCase();
      if (label.indexOf(startString.toLowerCase()) === 0) {
        if (!ignoreDisabled || (ignoreDisabled && !this.normalizedOptions[i].disabled)) {
          return i;
        }
      }
    }

    return -1;
  };

  private updateStateFromValue = () => {
    let optionIndex = this.getIndexByValue(this.props.value);

    // If the value cannot be found in options, set the selected
    // option to the first option
    if (optionIndex === -1) {
      optionIndex = 0;
    }

    this.setState({
      focusedOptionIndex: optionIndex,
      label: this.normalizedOptions[optionIndex].label,
      selectedOptionIndex: optionIndex,
    });
  };

  private toggleMenu = (show: boolean): void => {
    // Immediately wipe out removeMenuTimer if we're toggling the menu
    // (if, for example, we're toggling the menu on while it's hiding)
    if (this.removeMenuTimer) {
      clearTimeout(this.removeMenuTimer);
    }

    if (show) {
      this.setState(
        {
          focusedOptionIndex: this.state.selectedOptionIndex,
          isMenuHidden: false,
          isMenuHiding: false,
        },
        () => {
          // Shift focus to the menu
          if (this.menuRef.current) {
            this.menuRef.current.focus();
          }
        }
      );
    } else {
      this.setState({isMenuHiding: true});

      this.removeMenuTimer = setTimeout(() => {
        this.setState(
          {
            isMenuHidden: true,
            isMenuHiding: false,
          },
          () => {
            // Shift focus back to the button
            if (this.buttonRef.current) {
              this.buttonRef.current.focus();
            }
          }
        );
      }, menuFadeDuration);
    }
  };

  // Code inspired by: https://stackoverflow.com/a/46012210
  // In order for Select to be usable as a controlled component, we
  // need to programatically change the value of the SelectInput
  // in such a way that triggers its change event
  private fireChangeEvent = (value: string): void => {
    if (this.inputRef && this.inputRef.current) {
      const nativeInputValue = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(this.inputRef.current),
        'value'
      );
      if (nativeInputValue && nativeInputValue.set) {
        nativeInputValue.set.call(this.inputRef.current, value);
      }

      let event: Event;
      if (typeof Event === 'function') {
        // Modern browsers
        event = new Event('change', {bubbles: true});
      } else {
        // IE 11
        event = document.createEvent('Event');
        event.initEvent('change', true, true);
      }

      this.inputRef.current.dispatchEvent(event);
    }
  };

  private handleKeyboardTypeAhead = (key: string, numOptions: number) => {
    // Abort immediately if the menu is the process of hiding
    if (this.state.isMenuHiding) {
      return;
    }

    this.keysSoFar += key;
    this.startClearKeysSoFarTimer();

    // Set the starting point of the search to the next option after
    // the currently focused option
    let start = this.state.focusedOptionIndex + 1;
    let matchIndex;

    // If the starting point is beyond the list of options, reset it
    // to the beginning of the list
    start = start === numOptions ? 0 : start;

    // First, look for a match from start to end
    matchIndex = this.getIndexByStartString(start, this.keysSoFar);

    // If a match isn't found between start and end, wrap the search
    // around and search again from the beginning (0) to start
    if (matchIndex === -1) {
      matchIndex = this.getIndexByStartString(0, this.keysSoFar, start);
    }

    // A match was found...
    if (matchIndex > -1) {
      if (this.state.isMenuHidden) {
        // If the menu is hidden, fire the change event
        this.fireChangeEvent(this.normalizedOptions[matchIndex].value);
      } else {
        // Otherwise (the menu is visible), simply focus the matched option
        this.setState({focusedOptionIndex: matchIndex});
      }
    }
  };

  private startClearKeysSoFarTimer = () => {
    if (this.clearKeysSoFarTimer) {
      clearTimeout(this.clearKeysSoFarTimer);
    }
    this.clearKeysSoFarTimer = setTimeout(() => {
      this.keysSoFar = '';
    }, this.clearKeysSoFarTimeout);
  };

  constructor(props: SelectProps) {
    super(props);
    this.setNormalizedOptions();
  }

  componentDidMount() {
    this.updateStateFromValue();
  }

  componentDidUpdate(prevProps: SelectProps) {
    const {options, value} = this.props;

    if (options !== prevProps.options) {
      this.setNormalizedOptions();
    }

    if (value !== prevProps.value) {
      this.updateStateFromValue();
    }
  }

  componentWillUnmount() {
    // Clear timers
    if (this.removeMenuTimer) {
      clearTimeout(this.removeMenuTimer);
    }
    if (this.clearKeysSoFarTimer) {
      clearTimeout(this.clearKeysSoFarTimer);
    }
  }

  handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Cancel default handling of the event to ensure we maintain
    // control of focus
    event.preventDefault();

    this.toggleMenu(this.state.isMenuHidden);
  };

  handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // Cancel default handling of the event to ensure we maintain
    // control of focus
    event.preventDefault();
  };

  handleOptionSelection = (index: number): void => {
    // Abort immediately if:
    // * The menu is in the process of hiding
    // * A disabled option was clicked (we ignore these clicks)
    if (this.state.isMenuHiding || this.normalizedOptions[index].disabled) {
      return;
    }

    this.toggleMenu(false);
    this.fireChangeEvent(this.normalizedOptions[index].value);
  };

  handleMenuBlur = (event: React.FocusEvent): void => {
    this.toggleMenu(false);
  };

  handleKeyDown = (event: React.KeyboardEvent): void => {
    const {options} = this.props;
    const numOptions = options.length;

    const {focusedOptionIndex, isMenuHidden, isMenuHiding} = this.state;

    let isShortcut = false;
    let nextFocusedIndex = 0;

    // Check for type-ahead first
    if (event.key.length === 1 && event.key.match(/\S/)) {
      isShortcut = true;
      this.handleKeyboardTypeAhead(event.key, numOptions);
    } else {
      switch (event.key) {
        case 'ArrowUp':
        case 'Up': // IE/Edge specific value
        case 'ArrowDown':
        case 'Down': // IE/Edge specific value
          isShortcut = true;
          if (isMenuHidden || isMenuHiding) {
            this.toggleMenu(true);
          } else {
            const direction = event.key === 'ArrowUp' || event.key === 'Up' ? -1 : 1;
            let nextIndex = focusedOptionIndex + direction;
            while (
              nextIndex < numOptions &&
              nextIndex >= 0 &&
              this.normalizedOptions[nextIndex].disabled
            ) {
              nextIndex += direction;
            }
            nextFocusedIndex =
              nextIndex < 0 ? 0 : nextIndex >= numOptions ? numOptions - 1 : nextIndex;
            this.setState({focusedOptionIndex: nextFocusedIndex});
          }
          break;

        case 'Home':
        case 'End':
          isShortcut = true;
          nextFocusedIndex = event.key === 'Home' ? 0 : numOptions - 1;
          this.setState({focusedOptionIndex: nextFocusedIndex});
          break;

        case 'Spacebar':
        case ' ':
          isShortcut = true;
          // If the user is in the middle of typing a string, treat
          // space key as type-ahead rather than option selection
          if (this.keysSoFar !== '') {
            this.handleKeyboardTypeAhead(' ', numOptions);
          } else if (isMenuHidden || isMenuHiding) {
            this.toggleMenu(true);
          } else {
            this.handleOptionSelection(focusedOptionIndex);
          }
          break;

        case 'Enter':
          isShortcut = true;
          if (isMenuHidden || isMenuHiding) {
            this.toggleMenu(true);
          } else {
            this.handleOptionSelection(focusedOptionIndex);
          }
          break;

        default:
      }
    }

    if (isShortcut) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  public render() {
    const {
      // Strip options from elemProps
      options,
      value,
      ...elemProps
    } = this.props;

    const {focusedOptionIndex, isMenuHidden, isMenuHiding, label, selectedOptionIndex} = this.state;

    return (
      <SelectBase
        buttonRef={this.buttonRef}
        focusedOptionIndex={focusedOptionIndex}
        inputRef={this.inputRef}
        isMenuHidden={isMenuHidden}
        isMenuHiding={isMenuHiding}
        label={label}
        menuRef={this.menuRef}
        onClick={this.handleClick}
        onKeyDown={this.handleKeyDown}
        onMenuBlur={this.handleMenuBlur}
        onMouseDown={this.handleMouseDown}
        onOptionSelection={this.handleOptionSelection}
        options={this.normalizedOptions}
        selectedOptionIndex={selectedOptionIndex}
        value={this.getIndexByValue(value) !== -1 ? value : this.normalizedOptions[0].value}
        {...elemProps}
      />
    );
  }
}
